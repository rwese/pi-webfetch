/* global setTimeout, clearTimeout:readonly */

/**
 * Pi Agent spawning for research queries
 *
 * Spawns a pi sub-agent to analyze fetched content based on a query.
 */

import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { cwd, env } from 'node:process';

export interface SpawnPiAgentOptions {
	/** Maximum time to wait for response in ms (default: 60000) */
	timeout?: number;
	/** Working directory for pi process */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
}

export interface SpawnPiAgentResult {
	/** The analysis result from the sub-agent */
	analysis: string;
	/** Exit code of the pi process */
	exitCode: number;
}

/**
 * Custom error for spawn failures
 */
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
	// For now, just return 'pi' and let it resolve via PATH
	// Could be enhanced to check common locations
	return 'pi';
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
	const { timeout = 60000, cwd: cwdOption = cwd(), env: envOption = {} } = options;

	// Dynamic import for better testability
	const { spawn } = await import('node:child_process');

	return new Promise((resolve, reject) => {
		const piPath = findPiExecutable();

		// Build the system prompt for research mode
		const systemPrompt = join(homedir(), '.pi', 'agent', 'AGENTS.md');
		const researchPrompt = `Research Question: ${query}\n\nContent to analyze:\n${content}`;

		const proc: ChildProcess = spawn(
			piPath,
			['--mode', 'json', '-p', '--no-session', '--append-system-prompt', systemPrompt],
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

		// Collect stdout
		proc.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		// Collect stderr
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

		// Write the research prompt to stdin
		proc.stdin?.write(researchPrompt);
		proc.stdin?.end();
	});
}

/**
 * Check if pi executable is available
 */
export function isPiAvailable(): boolean {
	// Simple check - could be enhanced with actual availability check
	return true;
}
