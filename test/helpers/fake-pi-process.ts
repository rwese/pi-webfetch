/**
 * Fake pi process for testing spawnPiAgent
 *
 * Simulates the pi subprocess behavior for controlled testing.
 * Can be configured with different response modes.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';

export interface FakePiProcessConfig {
	/** Simulated exit code (default: 0) */
	exitCode?: number;
	/** Simulated stdout output */
	stdout?: string;
	/** Simulated stderr output */
	stderr?: string;
	/** Simulated delay before responding (ms) */
	delay?: number;
	/** Whether to emit 'error' event instead of closing */
	emitError?: boolean;
}

export interface FakePiProcess extends EventEmitter {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill(signal?: string): void;
	on(event: 'close', listener: (code: number) => void): this;
	on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * Create a fake pi process for testing
 *
 * @param config - Configuration for the fake process
 * @returns Fake process that mimics node:child_process spawn behavior
 *
 * @example
 * ```typescript
 * const fake = createFakePiProcess({
 *   stdout: 'Analysis complete',
 *   exitCode: 0
 * });
 *
 * // Use with spawn mock
 * vi.spyOn(childProcess, 'spawn').mockReturnValue(fake);
 *
 * // Simulate process completion
 * fake.emit('close', 0);
 * ```
 */
export function createFakePiProcess(config: FakePiProcessConfig = {}): FakePiProcess {
	const {
		exitCode = 0,
		stdout = '',
		stderr = '',
		delay = 0,
		emitError = false,
	} = config;

	const fake = new EventEmitter() as FakePiProcess;
	fake.stdout = new EventEmitter();
	fake.stderr = new EventEmitter();
	fake.kill = vi.fn();

	// Simulate async process behavior
	if (delay > 0) {
		setTimeout(() => {
			if (emitError) {
				fake.emit('error', new Error('Fake process error'));
			} else {
				if (stdout) fake.stdout.emit('data', stdout);
				if (stderr) fake.stderr.emit('data', stderr);
				fake.emit('close', exitCode);
			}
		}, delay);
	} else {
		// Synchronous for testing convenience
		if (emitError) {
			process.nextTick(() => fake.emit('error', new Error('Fake process error')));
		} else {
			process.nextTick(() => {
				if (stdout) fake.stdout.emit('data', stdout);
				if (stderr) fake.stderr.emit('data', stderr);
				fake.emit('close', exitCode);
			});
		}
	}

	return fake;
}

/**
 * Preset: Success response
 */
export function fakePiSuccess(response: string): FakePiProcess {
	return createFakePiProcess({ stdout: response, exitCode: 0 });
}

/**
 * Preset: Error response
 */
export function fakePiError(message: string, exitCode = 1): FakePiProcess {
	return createFakePiProcess({ stderr: message, exitCode });
}

/**
 * Preset: Slow response (for timeout testing)
 */
export function fakePiSlow(response: string, delayMs: number): FakePiProcess {
	return createFakePiProcess({ stdout: response, delay: delayMs });
}
