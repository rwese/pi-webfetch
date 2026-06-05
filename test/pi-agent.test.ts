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

	it('passes default research skills and tools', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query');

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		// Should include -p with the prompt
		expect(args).toContain('-p');
		// Should include --skill for agent-browser
		expect(args).toContain('--skill');
		// Should include --tools with default tools
		expect(args).toContain('--tools');
	});

	it('allows disabling skills', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', { skills: [] });

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		// Should not include --skill
		const skillIndex = args.indexOf('--skill');
		expect(skillIndex).toBe(-1);
	});

	it('allows custom skills', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', { skills: ['github', 'planning'] });

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		// Should include --skill twice
		const skillCount = args.filter(arg => arg === '--skill').length;
		expect(skillCount).toBe(2);
	});

	it('allows passing extension paths', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', {
			extensions: ['/path/to/extension.ts'],
		});

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		// Should include -e with extension path
		expect(args).toContain('-e');
		expect(args).toContain('/path/to/extension.ts');
	});

	it('respects noExtensions option', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', { noExtensions: true });

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		// Should include --no-extensions
		expect(args).toContain('--no-extensions');
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

	it('passes --session-id and --name when both are provided', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query', {
			sessionId: 'abc123def4567890',
			sessionName: 'webfetch-research: example.com',
		});

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		const idIndex = args.indexOf('--session-id');
		expect(idIndex).toBeGreaterThanOrEqual(0);
		expect(args[idIndex + 1]).toBe('abc123def4567890');

		const nameIndex = args.indexOf('--name');
		expect(nameIndex).toBeGreaterThanOrEqual(0);
		expect(args[nameIndex + 1]).toBe('webfetch-research: example.com');
	});

	it('omits --session-id and --name when not provided (back-compat)', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		await spawnPiAgent('Content', 'Query');

		const call = vi.mocked(spawn).mock.calls[0];
		const args = call[1] as string[];

		expect(args).not.toContain('--session-id');
		expect(args).not.toContain('--name');
	});

	it('echoes sessionId and sessionName back on the result', async () => {
		const fake = fakePiSuccess('Result');

		const { spawn } = await import('node:child_process');
		vi.mocked(spawn).mockReturnValue(fake as any);

		const result = await spawnPiAgent('Content', 'Query', {
			sessionId: 'persistent-id',
			sessionName: 'webfetch-research: example.com',
		});

		expect(result.sessionId).toBe('persistent-id');
		expect(result.sessionName).toBe('webfetch-research: example.com');
		expect(result.analysis).toBe('Result');
		expect(result.exitCode).toBe(0);
	});
});

describe('isPiAvailable', () => {
	it('returns true (mocked environment)', () => {
		expect(isPiAvailable()).toBe(true);
	});
});
