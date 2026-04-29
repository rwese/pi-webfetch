import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
	createFakePiProcess,
	fakePiSuccess,
	fakePiError,
	fakePiSlow,
} from './helpers/fake-pi-process';
import { PiAgentError, spawnPiAgent, isPiAvailable } from '../extensions/pi-agent';

// Mock child_process module
vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
}));

describe('fake-pi-process', () => {
	describe('createFakePiProcess', () => {
		it('emits stdout and close events', () => new Promise<void>((resolve) => {
			const fake = createFakePiProcess({ stdout: 'test output', exitCode: 0 });

			let stdoutData = '';
			fake.stdout.on('data', (data) => {
				stdoutData += data;
			});

			fake.on('close', (code) => {
				expect(stdoutData).toBe('test output');
				expect(code).toBe(0);
				resolve();
			});
		}));

		it('handles stderr output', () => new Promise<void>((resolve) => {
			const fake = createFakePiProcess({ stderr: 'error message', exitCode: 1 });

			let stderrData = '';
			fake.stderr.on('data', (data) => {
				stderrData += data;
			});

			fake.on('close', (code) => {
				expect(stderrData).toBe('error message');
				expect(code).toBe(1);
				resolve();
			});
		}));

		it('emits error event when configured', () => new Promise<void>((resolve) => {
			const fake = createFakePiProcess({ emitError: true });

			fake.on('error', (err) => {
				expect(err.message).toBe('Fake process error');
				resolve();
			});
		}));

		it('handles configurable delay', async () => {
			const fake = createFakePiProcess({ stdout: 'delayed', delay: 50 });

			return new Promise<void>((resolve) => {
				fake.on('close', (code) => {
					expect(code).toBe(0);
					resolve();
				});
			});
		});
	});

	describe('fakePiSuccess preset', () => {
		it('creates successful process with given response', () => new Promise<void>((resolve) => {
			const fake = fakePiSuccess('Analysis result');

			let stdoutData = '';
			fake.stdout.on('data', (data) => {
				stdoutData += data;
			});

			fake.on('close', (code) => {
				expect(stdoutData).toBe('Analysis result');
				expect(code).toBe(0);
				resolve();
			});
		}));
	});

	describe('fakePiError preset', () => {
		it('creates failing process with error message', () => new Promise<void>((resolve) => {
			const fake = fakePiError('Something went wrong');

			let stderrData = '';
			fake.stderr.on('data', (data) => {
				stderrData += data;
			});

			fake.on('close', (code) => {
				expect(stderrData).toBe('Something went wrong');
				expect(code).toBe(1);
				resolve();
			});
		}));

		it('supports custom exit code', () => new Promise<void>((resolve) => {
			const fake = fakePiError('Failed', 2);

			fake.on('close', (code) => {
				expect(code).toBe(2);
				resolve();
			});
		}));
	});

	describe('fakePiSlow preset', () => {
		it('creates slow responding process', async () => {
			const fake = fakePiSlow('Result', 100);

			return new Promise<void>((resolve) => {
				fake.stdout.on('data', () => {
					resolve();
				});
			});
		});
	});
});

describe('spawnPiAgent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('resolves with analysis on successful spawn', async () => {
		const fake = fakePiSuccess('Research findings');

		// Re-import to get fresh module with mocked spawn
		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		const result = await spawnPiAgent('Some content', 'What is this about?');

		expect(result.analysis).toBe('Research findings');
		expect(result.exitCode).toBe(0);
	});

	it('rejects with PiAgentError on non-zero exit', async () => {
		const fake = fakePiError('Analysis failed');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await expect(spawnPiAgent('Content', 'Analyze this'))
			.rejects.toThrow();
	});

	it('rejects with PiAgentError on spawn error', async () => {
		const fake = createFakePiProcess({ emitError: true });

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await expect(spawnPiAgent('Content', 'Query'))
			.rejects.toThrow('Failed to spawn pi');
	});

	it('respects timeout option', async () => {
		// Create a fake that triggers timeout
		const fake = createFakePiProcess({
			exitCode: 1,
			// Delay longer than test timeout to ensure timeout fires first
			delay: 200,
		});

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await expect(spawnPiAgent('Content', 'Query', { timeout: 50 }))
			.rejects.toThrow('timed out');
	}, 5000);

	it('passes custom environment variables', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', {
			env: { CUSTOM_VAR: 'test', ANOTHER: 'value' },
		});

		expect(vi.mocked(spawn)).toHaveBeenCalled();
	});

	it('passes custom working directory', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', { cwd: '/custom/path' });

		expect(vi.mocked(spawn)).toHaveBeenCalled();
	});
});

describe('isPiAvailable', () => {
	it('returns true (mocked environment)', () => {
		expect(isPiAvailable()).toBe(true);
	});
});
