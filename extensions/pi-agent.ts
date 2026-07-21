/**
 * Pi Agent spawning for research queries
 *
 * Spawns a pi sub-agent to analyze fetched content based on a query.
 * The subprocess gets access to relevant skills and tools for smarter analysis.
 *
 * The transport is JSON-RPC over stdio (see `extensions/pi-rpc-client.ts`).
 * The previous print-mode `-p <prompt>` spawn is gone; the subagent is
 * driven as a real, named, persistent pi session that streams text
 * deltas and tool events back to the parent so the parent can render
 * live progress (see `docs/plans/PLAN_PI_JSONRPC.md`).
 */

import { existsSync } from 'node:fs';
import { cwd } from 'node:process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { PiRpcClient, type PiRpcToolEvent } from './pi-rpc-client.js';
import type { ResearchModelConfig } from './model-config.js';

export interface SpawnPiAgentOptions {
	/**
	 * Maximum time to wait for response in ms. The default
	 * (see {@link DEFAULT_PI_AGENT_TIMEOUT_MS}) is sized for
	 * non-trivial research queries on large pages. Callers that
	 * want a different budget can pass a positive integer in
	 * milliseconds; the CLI / MCP / pi tool surfaces each expose
	 * a `timeout` knob for this.
	 */
	timeout?: number;
	/** Model selected for the research subagent. Omit to use Pi's normal default. */
	model?: ResearchModelConfig;
	/** Working directory for pi process */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Callback for streaming output chunks (for live UI updates) */
	onChunk?: (chunk: string) => void;
	/**
	 * Callback for tool events from the subagent. Fires on
	 * `tool_execution_start` with a parent-friendly phase
	 * (`'reading'` for `read` / `grep` / `find` / `ls`,
	 * `'executing'` for `bash`, `'thinking'` for everything
	 * else). **Default: no-op** (back-compat with existing
	 * callers).
	 */
	onToolCall?: (event: PiRpcToolEvent) => void;
	/** Additional skills to load for the research agent */
	skills?: string[];
	/** Additional extension paths to load */
	extensions?: string[];
	/** Explicitly disable extensions (default: false) */
	noExtensions?: boolean;
	/**
	 * Persistent session id to assign to the spawned subagent. When set, the
	 * subagent is launched with `--session-id <id>` so its transcript is
	 * resumable via `pi --session <id>`. Optional for back-compat with
	 * callers that don't need a resumable subagent.
	 */
	sessionId?: string;
	/**
	 * Human-readable session name passed to the subagent as `--name <name>`.
	 * Surfaced in `pi -r` pickers. Optional; only added when `sessionId` is
	 * also set.
	 */
	sessionName?: string;
	/**
	 * URL the content was fetched from. Surfaced in the prompt so
	 * the subagent can re-look-up additional pages or attribute
	 * quotes / facts back to the source. Optional; the prompt
	 * omits the `URL:` line when not set.
	 */
	url?: string;
	/**
	 * Absolute path to the markdown input file (`input.md`).
	 * The prompt references this path; the subagent uses its
	 * `read` tool to load the content on demand. Optional; when
	 * not set, the prompt's `Input (markdown):` line is omitted
	 * and the prompt has no in-content payload (the subagent
	 * must rely on its own tools to find content).
	 */
	inputFile?: string;
	/**
	 * Absolute path to the raw input file (`input_raw.<ext>`).
	 * The prompt references this path; the subagent can grep
	 * the original markup when the markdown conversion drops
	 * something. Optional; when not set, the prompt shows
	 * `Input (raw): (not available)`.
	 */
	inputRawFile?: string;
}

/**
 * Default wall-clock budget for the research subagent in milliseconds.
 *
 * The previous 60s default was too tight for non-trivial research
 * queries against large pages (e.g. fontawesome.com docs) and
 * surfaced as `Pi agent timed out after 60000ms` even when the
 * subagent was making progress. 180s covers typical research
 * queries on large pages while still bounding the worst case.
 * Override per-call via `SpawnPiAgentOptions.timeout` or via the
 * `--timeout` flag (CLI) / `timeout` field (MCP / tool).
 */
// fallow-ignore-next-line unused-exports
export const DEFAULT_PI_AGENT_TIMEOUT_MS = 300_000;

/** Default skills for research queries */
// fallow-ignore-next-line unused-exports
export const DEFAULT_RESEARCH_SKILLS = ['agent-browser', 'planning'];

/** Default tools enabled for research */
// fallow-ignore-next-line unused-exports
export const DEFAULT_RESEARCH_TOOLS = ['read', 'grep', 'find', 'ls', 'bash'];

export interface SpawnPiAgentResult {
	/** The analysis result from the sub-agent */
	analysis: string;
	/** Exit code of the pi process */
	exitCode: number;
	/**
	 * Persistent session id of the spawned subagent. Sourced from
	 * the live `get_state` response on the JSON-RPC transport, not
	 * from the pre-computed id; if the subagent reassigned the
	 * id, the live value wins. `undefined` when the caller did
	 * not request a resumable session.
	 */
	sessionId?: string;
	/**
	 * Human-readable session name of the spawned subagent. Sourced
	 * from the live `get_state` response.
	 */
	sessionName?: string;
}

/**
 * Custom error for spawn failures
 */
// fallow-ignore-next-line unused-exports
export class PiAgentError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number | null,
		public readonly stderr?: string,
	) {
		super(message);
		this.name = 'PiAgentError';
	}
}

/**
 * Find the pi executable path
 */
function findPiExecutable(): string {
	return 'pi';
}

/**
 * Resolve skill paths from skill names.
 *
 * For each skill name, search common skill directories
 * (`~/.pi/agent/skills`, `~/.agents/skills`, `<cwd>/.pi/skills`) and
 * return the first existing path. Non-existent skill dirs are
 * silently dropped (a debug-level log is emitted in test envs).
 */
function resolveSkillPaths(skillNames: string[]): string[] {
	const skillDirs = [
		resolve(homedir(), '.pi/agent/skills'),
		resolve(homedir(), '.agents/skills'),
		resolve(process.cwd(), '.pi/skills'),
	];

	const paths: string[] = [];
	for (const skill of skillNames) {
		let resolved = false;
		for (const dir of skillDirs) {
			const skillPath = resolve(dir, skill);
			try {
				if (existsSync(skillPath)) {
					paths.push(skillPath);
					resolved = true;
					break;
				}
			} catch {
				// Permission denied / race; treat as not found.
			}
		}
		if (!resolved) {
			// Best-effort: surface a debug hint without throwing.
			// The wrapper does not need a missing skill to be fatal.
			if (process.env['PI_WEBFETCH_DEBUG_SKILLS'] === '1') {
				console.error(`[pi-webfetch] skill not found: ${skill}`);
			}
		}
	}
	return paths;
}

/**
 * Inputs for {@link buildResearchPrompt}. The content itself is NOT
 * inlined in the prompt; the prompt references the file paths so
 * the LLM sees a small, focused system message and `read`s the
 * content on demand. The caller is responsible for writing the
 * files to `inputFile` / `inputRawFile` before the spawn.
 */
export interface ResearchPromptInput {
	/** The research question / analysis request. */
	query: string;
	/** URL the content was fetched from. Surfaced for further lookups. */
	url?: string;
	/**
	 * Subagent's working directory (inherited from the parent by
	 * default). Surfaced so the subagent knows where it is running
	 * and can resolve relative paths.
	 */
	cwd?: string;
	/** Human-readable session name (visible in `pi -r`). */
	sessionName?: string;
	/** Persistent subagent session id. */
	sessionId?: string;
	/** Absolute path to the markdown input file (`input.md`). */
	inputFile?: string;
	/** Absolute path to the raw input file (`input_raw.<ext>`). */
	inputRawFile?: string;
}

/**
 * Build the research prompt. The prompt is intentionally lean: it
 * surfaces the URL, the cwd, the session name, and the file paths
 * to the input files, but inlines none of the content. The
 * subagent uses its `read` / `grep` tools to load the content on
 * demand, which keeps the LLM context small and makes the prompt
 * stable across very different page sizes.
 *
 * The instruction block is directive-first: the subagent is told
 * what to produce and what to avoid, with a short tool-reference
 * section at the bottom. No generic "provide a thorough analysis"
 * boilerplate.
 */
export function buildResearchPrompt(input: ResearchPromptInput): string {
	const { query, url, cwd, sessionName, sessionId, inputFile, inputRawFile } = input;

	const contextLines: string[] = [];
	if (url) contextLines.push(`URL: ${url}`);
	if (cwd) contextLines.push(`CWD: ${cwd}`);
	if (sessionName)
		contextLines.push(`Session: ${sessionName}${sessionId ? ` (id: ${sessionId})` : ''}`);
	if (inputFile) contextLines.push(`Input (markdown): ${inputFile}`);
	contextLines.push(`Input (raw): ${inputRawFile ?? '(not available)'}`);

	return `# Answer the query below. Use the file paths to load content.

${contextLines.join('\n')}

## Query

${query}

## Instructions

- Read the input markdown at \`${inputFile}\` with the \`read\` tool.
- If a raw input is available, use \`read ${inputRawFile ?? '<raw-input>'}\` to grep the original markup (the markdown conversion may drop metadata, hidden JSON, or attribute values).
- Answer the query directly. No preamble, no "Based on the content,", no "Here is a summary:".
- Be concise. If the answer is a list, give a plain list. If it is a description, give 1–3 sentences.
- If the query asks for specific items (endpoints, links, values), extract them exactly. Do not summarise them away.
- If the query asks for a summary, summarise — do not enumerate.

## Tools

read, grep, find, ls, bash
`;
}

/**
 * Build the argv for the `pi` subprocess.
 *
 * The argv shape is transport-agnostic. The first two args are
 * `--mode rpc` (so `pi` starts in JSON-RPC mode); the rest are
 * the session / skill / tool flags shared with the previous
 * print-mode spawn.
 */
function buildArgv(
	piPath: string,
	options: {
		skills: string[];
		extensions?: string[];
		noExtensions: boolean;
		sessionId?: string;
		sessionName?: string;
		model?: ResearchModelConfig;
	},
): string[] {
	const args: string[] = ['--mode', 'rpc'];

	// Pin the configured research model without changing the parent session model.
	if (options.model) {
		args.push('--provider', options.model.provider, '--model', options.model.id);
	}

	// Add skills (only existing paths on disk; `resolveSkillPaths`
	// already filters out non-existent skill directories).
	const skillPaths = resolveSkillPaths(options.skills);
	for (const path of skillPaths) {
		args.push('--skill', path);
	}

	// Add explicit extension paths
	if (options.extensions) {
		for (const ext of options.extensions) {
			args.push('-e', ext);
		}
	}

	// Disable extensions discovery unless we have explicit extensions
	if (options.noExtensions && !options.extensions?.length) {
		args.push('--no-extensions');
	}

	// Promote the subagent to a real, named, persistent pi session so
	// the user can `pi --session <id>` it after a failure. The plan
	// (`docs/plans/PLAN_AGENT_ERROR_RESUME.md`) is what makes these
	// resumable subagents part of the failure-ux contract.
	if (options.sessionId) {
		args.push('--session-id', options.sessionId);
		if (options.sessionName) {
			args.push('--name', options.sessionName);
		}
	}

	// Enable useful tools (use allowlist for focused toolset)
	args.push('--tools', DEFAULT_RESEARCH_TOOLS.join(','));

	// Touch the unused-parameter so eslint doesn't complain about the
	// the `piPath` arg. We return `args`; the wrapper handles the
	// `pi` binary via its `piPath` option.
	void piPath;

	return args;
}

/**
 * Spawn a pi sub-agent to analyze content based on a query
 *
 * The transport is JSON-RPC over stdio via {@link PiRpcClient}.
 * Text deltas and tool events are streamed to the optional
 * `onChunk` / `onToolCall` callbacks for live UI updates.
 *
 * @param _content - The fetched content to analyze. Accepted for
 *   back-compat with the previous signature; NOT inlined in the
 *   prompt (the lean path references the file paths via
 *   `inputFile` / `inputRawFile`).
 * @param query - The research question or analysis request
 * @param options - Optional configuration
 * @returns The analysis result from the sub-agent
 * @throws {PiAgentError} If spawn fails or process exits with error
 *
 * @example
 * ```typescript
 * const result = await spawnPiAgent(
 *   'Article content here...',
 *   'What is the main topic?'
 * );
 * console.log(result.analysis);
 * ```
 */
export async function spawnPiAgent(
	_content: string,
	query: string,
	options: SpawnPiAgentOptions = {},
): Promise<SpawnPiAgentResult> {
	const {
		timeout = DEFAULT_PI_AGENT_TIMEOUT_MS,
		model,
		cwd: cwdOption = cwd(),
		env: envOption = {},
		onChunk,
		onToolCall,
		skills = DEFAULT_RESEARCH_SKILLS,
		extensions,
		noExtensions = false,
		sessionId,
		sessionName,
		url,
		inputFile,
		inputRawFile,
	} = options;

	const piPath = findPiExecutable();
	const args = buildArgv(piPath, {
		skills,
		extensions,
		noExtensions,
		sessionId,
		sessionName,
		model,
	});

	// Build the lean research prompt. The content is NOT inlined;
	// the prompt references `inputFile` / `inputRawFile` and the
	// subagent `read`s them on demand.
	const prompt = buildResearchPrompt({
		query,
		url,
		cwd: cwdOption,
		sessionId,
		sessionName,
		inputFile,
		inputRawFile,
	});

	const client = new PiRpcClient({
		piPath,
		cwd: cwdOption,
		env: envOption,
		args,
	});

	if (onChunk) client.onText(onChunk);
	if (onToolCall) client.onTool(onToolCall);

	try {
		const result = await client.run({ prompt, timeoutMs: timeout });
		return {
			analysis: result.text.trim(),
			exitCode: result.exitCode,
			// Prefer the live sessionId from `get_state`; fall back
			// to the pre-computed id if the subagent didn't report
			// one (e.g. the subagent exited before `get_state`
			// resolved — the wrapper would have rejected in that
			// case, so this is a defensive default).
			sessionId: result.sessionId || sessionId,
			sessionName: result.sessionName || sessionName,
		};
	} catch (err) {
		// Best-effort cleanup on failure. The wrapper's `stop()`
		// is a no-op when the process is already gone.
		await client.stop().catch(() => {});
		throw err;
	}
}

/**
 * Check if pi executable is available
 */
export function isPiAvailable(): boolean {
	// Simple check - could be enhanced with actual availability check
	return true;
}
