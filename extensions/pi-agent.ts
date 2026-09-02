/**
 * Pi Agent for research queries
 *
 * Runs a pi sub-agent in-process to analyze fetched content based on a query.
 * The subagent is a direct `AgentSession` from the
 * `@earendil-works/pi-coding-agent` SDK (see `extensions/pi-session.ts` and
 * `docs/plans/PLAN_SDK_IN_PROCESS.md`), so pi-webfetch controls the subagent's
 * tools, model, and API keys directly — no pre-configured `pi` runtime needed.
 *
 * The previous spawned `pi --mode rpc` JSON-RPC subprocess transport is gone.
 * Text deltas and tool events stream from the in-process session via the
 * `onChunk` / `onToolCall` / `onThinking` callbacks.
 */

import { cwd } from 'node:process';
import {
	runPiSession,
	type PiSessionToolEvent,
	type ToolPhase,
	DEFAULT_RESEARCH_TOOLS as SESSION_DEFAULT_TOOLS,
} from './pi-session.js';
import type { ResearchModelConfig } from './model-config.js';
import { PiAgentError } from './pi-errors.js';

export { PiAgentError } from './pi-errors.js';
export type { PiSessionToolEvent, ToolPhase };

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
	/** Model + optional API key for the research subagent. */
	model?: ResearchModelConfig;
	/** Working directory for the subagent */
	cwd?: string;
	/**
	 * Environment variables layered over `process.env` when resolving the
	 * model's API key. Best-effort: the SDK reads `process.env` directly.
	 */
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
	onToolCall?: (event: PiSessionToolEvent) => void;
	/** Callback for `thinking_delta` events from the subagent. */
	onThinking?: (chunk: string) => void;
	/**
	 * Additional skills to load for the research agent. Accepted for
	 * back-compat; the in-process session uses the `tools` allowlist and does
	 * not load pi skills. No-op.
	 */
	skills?: string[];
	/**
	 * Additional extension paths to load. Accepted for back-compat; the
	 * in-process session does not load pi extensions. No-op.
	 */
	extensions?: string[];
	/**
	 * Explicitly disable extensions (default: false). Accepted for
	 * back-compat; the in-process session does not load pi extensions. No-op.
	 */
	noExtensions?: boolean;
	/**
	 * Persistent session id to seed the in-process session with. When set, the
	 * subagent transcript is resumable via `pi --session <id>`. Optional for
	 * back-compat with callers that don't need a resumable subagent.
	 */
	sessionId?: string;
	/**
	 * Human-readable session name passed to the subagent. Surfaced in
	 * `pi -r` pickers. Optional; only applied when `sessionId` is also set.
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
 * Sized for non-trivial research queries on large pages (e.g. fontawesome.com
 * docs). Override per-call via `SpawnPiAgentOptions.timeout` or via the
 * `--timeout` flag (CLI) / `timeout` field (MCP / tool).
 */
export const DEFAULT_PI_AGENT_TIMEOUT_MS = 300_000;

/** Default tools enabled for research */
export const DEFAULT_RESEARCH_TOOLS = [...SESSION_DEFAULT_TOOLS];

export interface SpawnPiAgentResult {
	/** The analysis result from the sub-agent */
	analysis: string;
	/** Exit code of the run (always 0 in-process; a failed turn throws). */
	exitCode: number;
	/**
	 * Persistent session id of the subagent. Sourced from the live in-process
	 * `AgentSession`; falls back to the pre-computed id if the session did not
	 * adopt one.
	 */
	sessionId?: string;
	/**
	 * Human-readable session name of the subagent. Sourced from the live
	 * in-process `AgentSession`.
	 */
	sessionName?: string;
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
 * Run a pi sub-agent in-process to analyze content based on a query.
 *
 * The subagent is a direct `AgentSession` from the SDK (no subprocess).
 * Text deltas and tool events stream to the optional `onChunk` / `onToolCall`
 * / `onThinking` callbacks for live UI updates.
 *
 * @param _content - The fetched content to analyze. Accepted for
 *   back-compat with the previous signature; NOT inlined in the
 *   prompt (the lean path references the file paths via
 *   `inputFile` / `inputRawFile`).
 * @param query - The research question or analysis request
 * @param options - Optional configuration
 * @returns The analysis result from the sub-agent
 * @throws {PiAgentError} If the model cannot be resolved, the run fails, or
 *   the run times out.
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
		env: envOption,
		onChunk,
		onToolCall,
		onThinking,
		sessionId,
		sessionName,
		url,
		inputFile,
		inputRawFile,
	} = options;

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

	try {
		const result = await runPiSession({
			prompt,
			cwd: cwdOption,
			timeoutMs: timeout,
			...(model ? { model } : {}),
			...(envOption ? { env: envOption } : {}),
			onChunk,
			onToolCall,
			onThinking,
			...(sessionId ? { sessionId } : {}),
			...(sessionName ? { sessionName } : {}),
		});
		return {
			analysis: result.analysis,
			exitCode: 0,
			sessionId: result.sessionId || sessionId,
			sessionName: result.sessionName || sessionName,
		};
	} catch (err) {
		if (err instanceof PiAgentError) throw err;
		throw err instanceof Error ? err : new Error(String(err));
	}
}

/**
 * Check if the pi coding-agent SDK is available
 */
export function isPiAvailable(): boolean {
	// The SDK is a runtime dependency; if this module loaded, it's available.
	return true;
}
