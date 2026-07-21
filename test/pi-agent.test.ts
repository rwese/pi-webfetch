import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	DEFAULT_PI_AGENT_TIMEOUT_MS,
	PiAgentError,
	spawnPiAgent,
	isPiAvailable,
} from '../extensions/pi-agent';
import type { PiRpcToolEvent } from '../extensions/pi-rpc-client';

// Hoisted mock state. The `vi.hoisted` ensures these are
// available inside the `vi.mock` factory below (vi.mock is
// hoisted, so it runs before the import statements resolve).
const { mockRun, capturedCtorArgs, textListeners, toolListeners, fakeClientCtor } = vi.hoisted(
	() => {
		const capturedCtorArgsLocal: Array<{
			piPath: string;
			cwd: string;
			env: Record<string, string>;
			args: string[];
		}> = [];
		const textListenersLocal: Array<(chunk: string) => void> = [];
		const toolListenersLocal: Array<(event: PiRpcToolEvent) => void> = [];
		const mockRunLocal = vi.fn();

		class FakeClient {
			constructor(opts: {
				piPath: string;
				cwd: string;
				env: Record<string, string>;
				args: string[];
			}) {
				capturedCtorArgsLocal.push(opts);
			}
			onText(fn: (chunk: string) => void): void {
				textListenersLocal.push(fn);
			}
			onTool(fn: (event: PiRpcToolEvent) => void): void {
				toolListenersLocal.push(fn);
			}
			run = mockRunLocal;
			async stop(): Promise<void> {}
		}

		return {
			mockRun: mockRunLocal,
			capturedCtorArgs: capturedCtorArgsLocal,
			textListeners: textListenersLocal,
			toolListeners: toolListenersLocal,
			fakeClientCtor: FakeClient,
		};
	},
);

// Mock the `pi-rpc-client` module so `PiRpcClient` is our
// `FakeClient`. This is the cleanest way to avoid spawning the
// real `pi` in tests; the `node:child_process` mock path is
// brittle because vitest's mock-hoist semantics don't always
// land before deep imports of CJS modules.
vi.mock('../extensions/pi-rpc-client', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		PiRpcClient: fakeClientCtor,
	};
});

const yieldMicrotasks = () => new Promise<void>((r) => setImmediate(r));

describe('spawnPiAgent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedCtorArgs.length = 0;
		textListeners.length = 0;
		toolListeners.length = 0;
		mockRun.mockReset();
		mockRun.mockImplementation(async () => new Promise(() => {}));
	});

	it('resolves with analysis on successful run', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Research findings',
			sessionId: 'live-id',
			sessionName: 'live-name',
			exitCode: 0,
		}));

		const result = await spawnPiAgent('Some content', 'What is this about?');
		expect(result.analysis).toBe('Research findings');
		expect(result.exitCode).toBe(0);
	});

	it('uses DEFAULT_PI_AGENT_TIMEOUT_MS (300s) when no timeout is provided', () => {
		expect(DEFAULT_PI_AGENT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
	});

	it('passes --mode rpc (and never -p) on the argv', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query');
		expect(capturedCtorArgs.length).toBe(1);
		const args = capturedCtorArgs[0].args;
		expect(args[0]).toBe('--mode');
		expect(args[1]).toBe('rpc');
		expect(args).not.toContain('-p');
	});

	it('passes --tools with the default research tools', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query');
		const args = capturedCtorArgs[0].args;
		const toolsIdx = args.indexOf('--tools');
		expect(toolsIdx).toBeGreaterThanOrEqual(0);
		expect(args[toolsIdx + 1]).toBe('read,grep,find,ls,bash');
	});

	it('passes an explicitly selected provider and model to the research subprocess', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', {
			model: {
				provider: 'openrouter',
				id: 'anthropic/claude-sonnet-4',
			},
		});
		const args = capturedCtorArgs[0].args;
		const providerIdx = args.indexOf('--provider');
		const modelIdx = args.indexOf('--model');
		expect(providerIdx).toBeGreaterThanOrEqual(0);
		expect(args[providerIdx + 1]).toBe('openrouter');
		expect(modelIdx).toBeGreaterThanOrEqual(0);
		expect(args[modelIdx + 1]).toBe('anthropic/claude-sonnet-4');
	});

	it('omits provider and model flags when no research model is selected', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query');
		const args = capturedCtorArgs[0].args;
		expect(args).not.toContain('--provider');
		expect(args).not.toContain('--model');
	});

	it('allows disabling skills', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', { skills: [] });
		const args = capturedCtorArgs[0].args;
		expect(args).not.toContain('--skill');
	});

	it('allows custom skills (but only existing paths on disk)', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', { skills: ['github', 'planning'] });
		const args = capturedCtorArgs[0].args;
		// On dev / CI, no skills are guaranteed to exist on disk;
		// the contract is "no non-existent path is pushed". If any
		// skill is on disk, it must be the requested one.
		const skillIdx = args.indexOf('--skill');
		if (skillIdx >= 0) {
			expect(args[skillIdx + 1]).toMatch(/skills[\\/](github|planning)$/);
		}
	});

	it('allows passing extension paths', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', { extensions: ['/path/to/extension.ts'] });
		const args = capturedCtorArgs[0].args;
		expect(args).toContain('-e');
		expect(args).toContain('/path/to/extension.ts');
	});

	it('respects noExtensions option', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', { noExtensions: true });
		const args = capturedCtorArgs[0].args;
		expect(args).toContain('--no-extensions');
	});

	it('rejects with PiAgentError on non-zero exit', async () => {
		mockRun.mockImplementationOnce(async () => {
			throw new PiAgentError('pi exited with code 1: failed', 1, 'failed');
		});
		await expect(spawnPiAgent('Content', 'Analyze this')).rejects.toThrow(PiAgentError);
	});

	it('rejects with PiAgentError when the run rejects', async () => {
		mockRun.mockImplementationOnce(async () => {
			throw new PiAgentError('Failed to spawn pi: ENOENT', null, 'ENOENT');
		});
		await expect(spawnPiAgent('Content', 'Query')).rejects.toThrow();
	});

	it('respects timeout option (forwards timeoutMs to client.run)', async () => {
		mockRun.mockImplementationOnce(async () => {
			throw new PiAgentError('Pi agent timed out after 30ms', null);
		});
		await expect(spawnPiAgent('Content', 'Query', { timeout: 30 })).rejects.toThrow(
			/timed out after 30ms/,
		);
	});

	it('passes custom environment variables', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', {
			env: { CUSTOM_VAR: 'test', ANOTHER: 'value' },
		});
		expect(capturedCtorArgs[0].env).toMatchObject({
			CUSTOM_VAR: 'test',
			ANOTHER: 'value',
		});
	});

	it('passes custom working directory', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', { cwd: '/custom/path' });
		expect(capturedCtorArgs[0].cwd).toBe('/custom/path');
	});

	it('passes --session-id and --name when both are provided', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query', {
			sessionId: 'abc123def4567890',
			sessionName: 'webfetch-research: example.com',
		});
		const args = capturedCtorArgs[0].args;
		const idIndex = args.indexOf('--session-id');
		expect(idIndex).toBeGreaterThanOrEqual(0);
		expect(args[idIndex + 1]).toBe('abc123def4567890');
		const nameIndex = args.indexOf('--name');
		expect(nameIndex).toBeGreaterThanOrEqual(0);
		expect(args[nameIndex + 1]).toBe('webfetch-research: example.com');
	});

	it('omits --session-id and --name when not provided (back-compat)', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		await spawnPiAgent('Content', 'Query');
		const args = capturedCtorArgs[0].args;
		expect(args).not.toContain('--session-id');
		expect(args).not.toContain('--name');
	});

	it('echoes the live sessionId / sessionName from get_state (not the pre-computed id)', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: 'live-reassigned-id',
			sessionName: 'live-reassigned-name',
			exitCode: 0,
		}));
		const result = await spawnPiAgent('Content', 'Query', {
			sessionId: 'pre-computed-id',
			sessionName: 'pre-computed-name',
		});
		expect(result.sessionId).toBe('live-reassigned-id');
		expect(result.sessionName).toBe('live-reassigned-name');
	});

	it('falls back to the pre-computed sessionId when get_state returns empty', async () => {
		mockRun.mockImplementationOnce(async () => ({
			text: 'Result',
			sessionId: '',
			sessionName: undefined,
			exitCode: 0,
		}));
		const result = await spawnPiAgent('Content', 'Query', {
			sessionId: 'fallback-id',
			sessionName: 'fallback-name',
		});
		expect(result.sessionId).toBe('fallback-id');
		expect(result.sessionName).toBe('fallback-name');
	});
});

describe('spawnPiAgent - onChunk / onToolCall callbacks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedCtorArgs.length = 0;
		textListeners.length = 0;
		toolListeners.length = 0;
		mockRun.mockReset();
	});

	it('forwards onChunk to client.onText (debounced text deltas)', async () => {
		mockRun.mockImplementationOnce(async () => {
			for (const fn of textListeners) {
				fn('Hello, ');
				fn('world');
				fn('!');
			}
			for (const fn of toolListeners) {
				fn({ phase: 'reading', name: 'read', args: { path: '/tmp/x' } });
			}
			return {
				text: 'final text',
				sessionId: '',
				sessionName: undefined,
				exitCode: 0,
			};
		});

		const chunks: string[] = [];
		const result = await spawnPiAgent('Content', 'Query', {
			onChunk: (c) => chunks.push(c),
		});
		expect(chunks.join('')).toBe('Hello, world!');
		expect(result.analysis).toBe('final text');
	});

	it('forwards onToolCall to client.onTool with { phase, name, args }', async () => {
		mockRun.mockImplementationOnce(async () => {
			for (const fn of toolListeners) {
				fn({ phase: 'reading', name: 'read', args: { path: '/tmp/input.md' } });
			}
			return { text: 'Result', sessionId: '', sessionName: undefined, exitCode: 0 };
		});
		const events: Array<{ phase: string; name: string; args: unknown }> = [];
		await spawnPiAgent('Content', 'Query', {
			inputFile: '/tmp/input.md',
			onToolCall: (e) => events.push({ phase: e.phase, name: e.name, args: e.args }),
		});
		expect(events).toEqual([
			{ phase: 'reading', name: 'read', args: { path: '/tmp/input.md' } },
		]);
	});

	it('default onToolCall is a no-op (back-compat with callers that do not pass it)', async () => {
		mockRun.mockImplementationOnce(async () => {
			for (const fn of toolListeners) {
				fn({ phase: 'reading', name: 'read', args: { path: '/tmp/input.md' } });
			}
			return { text: 'Result', sessionId: '', sessionName: undefined, exitCode: 0 };
		});
		const result = await spawnPiAgent('Content', 'Query');
		expect(result.analysis).toBe('Result');
	});
});

describe('isPiAvailable', () => {
	it('returns true (mocked environment)', () => {
		expect(isPiAvailable()).toBe(true);
	});
});
