/**
 * Process Utilities
 *
 * Shared utilities for executing external processes.
 */

import { spawn, ChildProcess } from 'node:child_process';

/**
 * Options for execAsync
 */
export interface ExecAsyncOptions {
	/** Timeout in milliseconds */
	timeout?: number;
	/** Working directory */
	cwd?: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Standard error output encoding (default: utf8) */
	encoding?: BufferEncoding;
}

/**
 * Result from execAsync
 */
export interface ExecAsyncResult {
	/** Standard output */
	stdout: string;
	/** Standard error */
	stderr: string;
	/** Exit code */
	code: number | null;
}

/**
 * Execute a command asynchronously using spawn
 *
 * @param command - The command to execute
 * @param args - Arguments to pass to the command
 * @param options - Optional configuration
 * @returns Promise resolving to stdout content
 */
export function execAsync(
	command: string,
	args: string[],
	options: ExecAsyncOptions = {}
): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : undefined,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString(options.encoding || 'utf8');
		});

		proc.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString(options.encoding || 'utf8');
		});

		let timer: NodeJS.Timeout | undefined;

		if (options.timeout) {
			timer = setTimeout(() => {
				proc.kill('SIGTERM');
				reject(new ExecAsyncError(`Command timed out after ${options.timeout}ms`, command, args, null, stderr));
			}, options.timeout);

			proc.on('close', () => {
				if (timer) clearTimeout(timer);
			});
		}

		proc.on('close', (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new ExecAsyncError(stderr || `Command exited with code ${code}`, command, args, code, stderr));
			}
		});

		proc.on('error', (err) => {
			if (timer) clearTimeout(timer);
			reject(new ExecAsyncError(err.message, command, args, null, stderr));
		});
	});
}

/**
 * Error class for execAsync failures
 */
export class ExecAsyncError extends Error {
	constructor(
		message: string,
		public readonly command: string,
		public readonly args: string[],
		public readonly exitCode: number | null,
		public readonly stderr: string
	) {
		super(`[${command}] ${message}`);
		this.name = 'ExecAsyncError';
	}
}

/**
 * Execute a command with full result access
 *
 * @param command - The command to execute
 * @param args - Arguments to pass to the command
 * @param options - Optional configuration
 * @returns Promise resolving to full result
 */
export async function execAsyncFull(
	command: string,
	args: string[],
	options: ExecAsyncOptions = {}
): Promise<ExecAsyncResult> {
	return new Promise((resolve, reject) => {
		const proc = spawn(command, args, {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : undefined,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout?.on('data', (data: Buffer) => {
			stdout += data.toString(options.encoding || 'utf8');
		});

		proc.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString(options.encoding || 'utf8');
		});

		let timer: NodeJS.Timeout | undefined;

		if (options.timeout) {
			timer = setTimeout(() => {
				proc.kill('SIGTERM');
				reject(new ExecAsyncError(`Command timed out after ${options.timeout}ms`, command, args, null, stderr));
			}, options.timeout);

			proc.on('close', () => {
				if (timer) clearTimeout(timer);
			});
		}

		proc.on('close', (code) => {
			resolve({ stdout, stderr, code });
		});

		proc.on('error', (err) => {
			if (timer) clearTimeout(timer);
			reject(new ExecAsyncError(err.message, command, args, null, stderr));
		});
	});
}

/**
 * Simple async mutex for preventing concurrent process access
 */
export class ProcessMutex {
	private locked = false;
	private waitQueue: Array<() => void> = [];

	/**
	 * Acquire the lock. If already locked, waits until lock is released.
	 */
	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}

		return new Promise<void>((resolve) => {
			this.waitQueue.push(resolve);
		});
	}

	/**
	 * Release the lock and process next waiting request
	 */
	release(): void {
		if (this.waitQueue.length > 0) {
			const next = this.waitQueue.shift();
			next!();
		} else {
			this.locked = false;
		}
	}

	/**
	 * Check if the mutex is currently locked
	 */
	isLocked(): boolean {
		return this.locked;
	}

	/**
	 * Execute a function with exclusive access
	 */
	async withLock<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}
}

/**
 * Kill a child process and all its children
 */
export function killProcessTree(proc: ChildProcess): void {
	if (proc.pid && proc.pid > 0) {
		try {
			process.kill(-proc.pid, 'SIGTERM'); // Kill process group
		} catch {
			// Process may have already exited
		}
	}
	proc.kill('SIGTERM');
}
