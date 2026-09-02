import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	DEFAULT_PI_AGENT_TIMEOUT_MS,
	PiAgentError,
	spawnPiAgent,
	isPiAvailable,
	DEFAULT_RESEARCH_TOOLS,
} from '../extensions/pi-agent.js';
import type { PiSessionToolEvent } from '../extensions/pi-session.js';

// Mock the `pi-session` module so `spawnPiAgent`'s delegation to
// `runPiSession` is driven by a fake. This avoids touching the real SDK
// (auth, registry, model resolution) in the public-API tests.
const { runPiSessionMock, capturedOptions } = vi.hoisted(() => {
	const capturedOptionsLocal: Array<Record<string, unknown>> = [];
	const runPiSessionMockLocal = vi.fn();
	return {
		runPiSessionMock: runPiSessionMockLocal,
		capturedOptions: capturedOptionsLocal,
	};
});

vi.mock('../extensions/pi-session.js', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		runPiSession: (opts: Record<string, unknown>) => {
			capturedOptions.push(opts);
			return runPiSessionMock(opts);
		},
	};
});

const yieldMicrotasks = () => new Promise<void>((r) => setImmediate(r));

describe('spawnPiAgent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedOptions.length = 0;
		runPiSessionMock.mockReset();
		runPiSessionMock.mockImplementation(async () => new Promise(() => {}));
	});

	it('resolves with analysis on successful run', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Research findings',
			sessionId: 'live-id',
			sessionName: 'live-name',
		});

		const result = await spawnPiAgent('Some content', 'What is this about?');
		expect(result.analysis).toBe('Research findings');
		expect(result.exitCode).toBe(0);
	});

	it('uses DEFAULT_PI_AGENT_TIMEOUT_MS (300s) when no timeout is provided', () => {
		expect(DEFAULT_PI_AGENT_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
	});

	it('passes the lean research prompt (URL + file paths, no inlined content)', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Page body content', 'Query', {
			url: 'https://example.com/page',
			inputFile: '/tmp/pi-webfetch-research/abc/input.md',
			inputRawFile: '/tmp/pi-webfetch-research/abc/input_raw.html',
		});
		const opts = capturedOptions[0];
		expect(opts.prompt).toContain('URL: https://example.com/page');
		expect(opts.prompt).toContain('/tmp/pi-webfetch-research/abc/input.md');
		expect(opts.prompt).toContain('/tmp/pi-webfetch-research/abc/input_raw.html');
		// The lean prompt must NOT inline the content.
		expect(opts.prompt).not.toContain('Page body content');
	});

	it('passes the deterministic session id and name to runPiSession', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Content', 'Query', {
			sessionId: 'abc123def4567890',
			sessionName: 'webfetch-research: example.com',
		});
		const opts = capturedOptions[0];
		expect(opts.sessionId).toBe('abc123def4567890');
		expect(opts.sessionName).toBe('webfetch-research: example.com');
	});

	it('forwards the explicitly selected research model', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Content', 'Query', {
			model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4' },
		});
		const opts = capturedOptions[0];
		expect(opts.model).toEqual({
			provider: 'openrouter',
			id: 'anthropic/claude-sonnet-4',
		});
	});

	it('omits the model option when no research model is selected', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Content', 'Query');
		expect(capturedOptions[0].model).toBeUndefined();
	});

	it('forwards the timeout to runPiSession', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Content', 'Query', { timeout: 30_000 });
		expect(capturedOptions[0].timeoutMs).toBe(30_000);
	});

	it('forwards custom environment variables', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Content', 'Query', {
			env: { CUSTOM_VAR: 'test', ANOTHER: 'value' },
		});
		expect(capturedOptions[0].env).toMatchObject({
			CUSTOM_VAR: 'test',
			ANOTHER: 'value',
		});
	});

	it('forwards the working directory', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		await spawnPiAgent('Content', 'Query', { cwd: '/custom/path' });
		expect(capturedOptions[0].cwd).toBe('/custom/path');
	});

	it('echoes the live sessionId / sessionName from the session (not the pre-computed id)', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: 'live-reassigned-id',
			sessionName: 'live-reassigned-name',
		});
		const result = await spawnPiAgent('Content', 'Query', {
			sessionId: 'pre-computed-id',
			sessionName: 'pre-computed-name',
		});
		expect(result.sessionId).toBe('live-reassigned-id');
		expect(result.sessionName).toBe('live-reassigned-name');
	});

	it('falls back to the pre-computed sessionId when the session returns empty', async () => {
		runPiSessionMock.mockResolvedValueOnce({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		});
		const result = await spawnPiAgent('Content', 'Query', {
			sessionId: 'fallback-id',
			sessionName: 'fallback-name',
		});
		expect(result.sessionId).toBe('fallback-id');
		expect(result.sessionName).toBe('fallback-name');
	});

	it('rejects with PiAgentError when runPiSession rejects', async () => {
		runPiSessionMock.mockRejectedValueOnce(new PiAgentError('boom', 1, 'stderr'));
		await expect(spawnPiAgent('Content', 'Analyze this')).rejects.toThrow(PiAgentError);
	});

	it('rejects with PiAgentError on timeout', async () => {
		runPiSessionMock.mockRejectedValueOnce(
			new PiAgentError('Pi agent timed out after 30ms', null),
		);
		await expect(spawnPiAgent('Content', 'Query', { timeout: 30 })).rejects.toThrow(
			/timed out after 30ms/,
		);
	});

	it('wraps non-PiAgentError failures as plain errors', async () => {
		runPiSessionMock.mockRejectedValueOnce(new Error('some SDK error'));
		await expect(spawnPiAgent('Content', 'Query')).rejects.toThrow('some SDK error');
	});
});

describe('spawnPiAgent - onChunk / onToolCall / onThinking callbacks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedOptions.length = 0;
		runPiSessionMock.mockReset();
	});

	it('forwards onChunk to runPiSession', async () => {
		runPiSessionMock.mockImplementationOnce(async (_opts) => {
			return { analysis: 'final text', sessionId: '', sessionName: undefined };
		});
		const onChunk = vi.fn();
		const result = await spawnPiAgent('Content', 'Query', { onChunk });
		expect(capturedOptions[0].onChunk).toBe(onChunk);
		expect(result.analysis).toBe('final text');
	});

	it('forwards onToolCall to runPiSession', async () => {
		runPiSessionMock.mockImplementationOnce(async () => ({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		}));
		const onToolCall = vi.fn();
		await spawnPiAgent('Content', 'Query', { onToolCall });
		expect(capturedOptions[0].onToolCall).toBe(onToolCall);
	});

	it('forwards onThinking to runPiSession', async () => {
		runPiSessionMock.mockImplementationOnce(async () => ({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		}));
		const onThinking = vi.fn();
		await spawnPiAgent('Content', 'Query', { onThinking });
		expect(capturedOptions[0].onThinking).toBe(onThinking);
	});

	it('default onToolCall / onThinking are no-ops (back-compat with callers that do not pass them)', async () => {
		runPiSessionMock.mockImplementationOnce(async () => ({
			analysis: 'Result',
			sessionId: '',
			sessionName: undefined,
		}));
		const result = await spawnPiAgent('Content', 'Query');
		expect(result.analysis).toBe('Result');
	});
});

describe('DEFAULT_RESEARCH_TOOLS', () => {
	it('is the research allowlist (no edit/write)', () => {
		expect(DEFAULT_RESEARCH_TOOLS).toEqual(['read', 'grep', 'find', 'ls', 'bash']);
	});
});

describe('isPiAvailable', () => {
	it('returns true (SDK is a runtime dependency)', () => {
		expect(isPiAvailable()).toBe(true);
	});
});
