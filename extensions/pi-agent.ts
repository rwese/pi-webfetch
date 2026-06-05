/**
 * Pi Agent spawning for research queries
 *
 * Spawns a pi sub-agent to analyze fetched content based on a query.
 * The subprocess gets access to relevant skills and tools for smarter analysis.
 */

import type { ChildProcess } from 'node:child_process';
import { cwd, env } from 'node:process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

export interface SpawnPiAgentOptions {
	/** Maximum time to wait for response in ms (default: 60000) */
	timeout?: number;
	/** Working directory for pi process */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Callback for streaming output chunks (for live UI updates) */
	onChunk?: (chunk: string) => void;
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
}

/** Default skills for research queries */
// fallow-ignore-next-line unused-exports
export const DEFAULT_RESEARCH_SKILLS = [
	'agent-browser',
	'planning',
];

/** Default tools enabled for research */
// fallow-ignore-next-line unused-exports
export const DEFAULT_RESEARCH_TOOLS = [
	'read',
	'grep',
	'find',
	'ls',
	'bash',
];

export interface SpawnPiAgentResult {
	/** The analysis result from the sub-agent */
	analysis: string;
	/** Exit code of the pi process */
	exitCode: number;
	/**
	 * Persistent session id of the spawned subagent. Echoed back so callers
	 * can surface a resume hint to the user. `undefined` when the caller did
	 * not request a resumable session.
	 */
	sessionId?: string;
	/**
	 * Human-readable session name of the spawned subagent. Echoed back so
	 * callers can surface it in resume hints.
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
 * Resolve skill paths from skill names
 * Checks common skill directories for the skill
 */
function resolveSkillPaths(skillNames: string[]): string[] {
	const skillDirs = [
		resolve(homedir(), '.pi/agent/skills'),
		resolve(homedir(), '.agents/skills'),
		resolve(process.cwd(), '.pi/skills'),
	];

	const paths: string[] = [];
	for (const skill of skillNames) {
		for (const dir of skillDirs) {
			const skillPath = resolve(dir, skill);
			// Check if it exists (could be a symlink or directory)
			try {
				// Just check if it resolves to something
				if (skillPath.includes(skill)) {
					paths.push(skillPath);
					break;
				}
			} catch {
				// Path doesn't exist, continue
			}
		}
	}
	return paths;
}

/**
 * Build the research prompt with context and instructions
 */
function buildResearchPrompt(query: string, content: string): string {
	return `# Research Query

${query}

---

## Content to Analyze

${content}

---

## Instructions

- Analyze the content above in relation to the research query
- Use available tools (bash, grep, read) to search within the content if needed
- If you need to fetch additional pages for context, use bash to call curl or webfetch
- Provide a thorough, well-structured response
- If searching for specific items (like "boot.img PQ3A.190801.002"), use grep/bash to search within the content
- Provide full links to found resources in footnotes with a short description

## Available Tools

- **read** - Read files or content sections
- **grep** - Search within text content (use bash with grep for large content)
- **find** - Find files in the filesystem
- **ls** - List directory contents
- **bash** - Execute shell commands (curl, grep, etc.)

## Available Skills

- **agent-browser** - For browser automation if interaction is needed
- **planning** - For structured analysis approach

---
`;
}

/**
 * Spawn a pi sub-agent to analyze content based on a query
 *
 * @param content - The fetched content to analyze
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
	content: string,
	query: string,
	options: SpawnPiAgentOptions = {},
): Promise<SpawnPiAgentResult> {
	const {
		timeout = 60000,
		cwd: cwdOption = cwd(),
		env: envOption = {},
		onChunk,
		skills = DEFAULT_RESEARCH_SKILLS,
		extensions,
		noExtensions = false,
		sessionId,
		sessionName,
	} = options;

	// Dynamic import for better testability
	const { spawn } = await import('node:child_process');

	return new Promise((resolve, reject) => {
		const piPath = findPiExecutable();

		// Build args array
		const args: string[] = [];

		// Build the research prompt
		const prompt = buildResearchPrompt(query, content);
		args.push('-p', prompt);

		// Add skills
		if (skills.length > 0) {
			const skillPaths = resolveSkillPaths(skills);
			for (const path of skillPaths) {
				args.push('--skill', path);
			}
		}

		// Add explicit extension paths
		if (extensions) {
			for (const ext of extensions) {
				args.push('-e', ext);
			}
		}

		// Disable extensions discovery unless we have explicit extensions
		if (noExtensions && !extensions?.length) {
			args.push('--no-extensions');
		}

		// Promote the subagent to a real, named, persistent pi session so
		// the user can `pi --session <id>` it after a failure. The plan
		// (`docs/plans/PLAN_AGENT_ERROR_RESUME.md`) is what makes these
		// resumable subagents part of the failure-ux contract.
		if (sessionId) {
			args.push('--session-id', sessionId);
			if (sessionName) {
				args.push('--name', sessionName);
			}
		}

		// Enable useful tools (use allowlist for focused toolset)
		args.push('--tools', DEFAULT_RESEARCH_TOOLS.join(','));

		const proc: ChildProcess = spawn(
			piPath,
			args,
			{
				stdio: ['ignore', 'pipe', 'pipe'],
				cwd: cwdOption,
				env: { ...env, ...envOption },
				timeout,
			},
		);

		let stdout = '';
		let stderr = '';

		// Set up timeout
		const timeoutHandle = setTimeout(() => {
			proc.kill('SIGTERM');
			reject(new PiAgentError(`Pi agent timed out after ${timeout}ms`, null));
		}, timeout);

		// Collect stdout - this is the analysis result
		// Stream chunks if callback provided for live UI updates
		proc.stdout?.on('data', (data: Buffer) => {
			const chunk = data.toString();
			stdout += chunk;
			onChunk?.(chunk);
		});

		// Collect stderr for error reporting
		proc.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		// Handle process completion
		proc.on('close', (code) => {
			clearTimeout(timeoutHandle);

			if (code === 0) {
				resolve({
					analysis: stdout.trim(),
					exitCode: code ?? 0,
					sessionId,
					sessionName,
				});
			} else {
				reject(new PiAgentError(stderr || `pi exited with code ${code}`, code, stderr));
			}
		});

		// Handle spawn errors
		proc.on('error', (err) => {
			clearTimeout(timeoutHandle);
			reject(new PiAgentError(`Failed to spawn pi: ${err.message}`, null, err.message));
		});
	});
}

/**
 * Check if pi executable is available
 */
export function isPiAvailable(): boolean {
	// Simple check - could be enhanced with actual availability check
	return true;
}
