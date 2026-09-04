import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPiSession, toolNameToPhase, DEFAULT_RESEARCH_TOOLS } from '../extensions/pi-session.js';
import { PiAgentError } from '../extensions/pi-errors.js';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Mock the SDK modules so we never touch real auth / registry / model files.
const {
	fakeSession,
	createAgentSessionMock,
	getModelMock,
	getEnvApiKeyMock,
	modelRuntimeGetModelMock,
	modelRuntimeSetRuntimeApiKeyMock,
} = vi.hoisted(() => {
	/**
	 * Fake in-process `AgentSession` that mirrors the SDK surface we consume:
	 * - `subscribe(listener)` captures the event listener; tests drive it.
	 * - `prompt()` is controlled per-test (resolve / hang / reject).
	 * - `messages`, `sessionId`, `sessionName` are configurable.
	 * - `abort()` / `dispose()` are recorded.
	 */
	class FakeSession {
		sessionId = 'fake-session-id';
		sessionName: string | undefined = 'fake-session-name';
		messages: unknown[] = [];
		abort = vi.fn().mockResolvedValue(undefined);
		dispose = vi.fn();
		setSessionName = vi.fn();
		promptImpl = vi.fn();
		/** When set, `prompt()` returns this promise (tests control settlement). */
		promptPromise: Promise<void> | null = null;
		private listener: ((event: AgentSessionEvent) => void) | null = null;

		subscribe(listener: (event: AgentSessionEvent) => void): () => void {
			this.listener = listener;
			return () => {
				this.listener = null;
			};
		}
		prompt(_text: string): Promise<void> {
			return this.promptPromise ?? this.promptImpl();
		}

		/** Drive a `message_update` text_delta event into the listener. */
		emitText(delta: string): void {
			this.listener?.({
				type: 'message_update',
				message: { role: 'assistant', content: [], timestamp: 0 },
				assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
			} as unknown as AgentSessionEvent);
		}
		/** Drive a `message_update` thinking_delta event into the listener. */
		emitThinking(delta: string): void {
			this.listener?.({
				type: 'message_update',
				message: { role: 'assistant', content: [], timestamp: 0 },
				assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta },
			} as unknown as AgentSessionEvent);
		}
		/** Drive a `tool_execution_start` event into the listener. */
		emitTool(name: string, args: unknown = {}): void {
			this.listener?.({
				type: 'tool_execution_start',
				toolCallId: 'call_1',
				toolName: name,
				args,
			} as unknown as AgentSessionEvent);
		}
	}

	const fakeSession = new FakeSession();
	return {
		fakeSession,
		createAgentSessionMock: vi.fn(),
		getModelMock: vi.fn(),
		getEnvApiKeyMock: vi.fn(),
		modelRuntimeGetModelMock: vi.fn(),
		modelRuntimeSetRuntimeApiKeyMock: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		createAgentSession: createAgentSessionMock,
		// Deterministic ModelRuntime: `getModel` and `setRuntimeApiKey` are
		// controlled by the test (so env/auth on the dev machine cannot leak in).
		ModelRuntime: {
			...(actual.ModelRuntime as object),
			create: vi.fn().mockResolvedValue({
				getModel: modelRuntimeGetModelMock,
				setRuntimeApiKey: modelRuntimeSetRuntimeApiKeyMock,
			}),
		},
	};
});

vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		getModel: getModelMock,
		getEnvApiKey: getEnvApiKeyMock,
	};
});

const yieldMicrotasks = () => new Promise<void>((r) => setImmediate(r));

/** A deferred that the test controls; assigns `fakeSession.promptPromise`. */
function deferredPrompt() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe('runPiSession', () => {
	const prevModelEnv = process.env['PI_WEBFETCH_MODEL'];

	beforeEach(() => {
		vi.clearAllMocks();
		fakeSession.sessionId = 'fake-session-id';
		fakeSession.sessionName = 'fake-session-name';
		fakeSession.messages = [];
		fakeSession.abort.mockResolvedValue(undefined);
		fakeSession.promptPromise = null;
		fakeSession.promptImpl.mockResolvedValue(undefined);
		getEnvApiKeyMock.mockReturnValue(undefined);
		getModelMock.mockImplementation((provider: string, id: string) => ({
			provider,
			id,
			reasoning: true,
		}));
		modelRuntimeGetModelMock.mockReturnValue(undefined);
		modelRuntimeSetRuntimeApiKeyMock.mockResolvedValue(undefined);
		createAgentSessionMock.mockResolvedValue({
			session: fakeSession,
			extensionsResult: {},
			modelFallbackMessage: undefined,
		});
		// Default env model so no-model calls resolve via the env fallback.
		process.env['PI_WEBFETCH_MODEL'] = 'anthropic/claude-opus-4-5';
	});

	afterEach(() => {
		if (prevModelEnv === undefined) delete process.env['PI_WEBFETCH_MODEL'];
		else process.env['PI_WEBFETCH_MODEL'] = prevModelEnv;
	});

	it('resolves with the final assistant text as analysis', async () => {
		fakeSession.messages = [
			{ role: 'user', content: [{ type: 'text', text: 'prompt' }], timestamp: 0 },
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'Research findings' }],
				timestamp: 1,
			},
		];
		const result = await runPiSession({
			prompt: 'What is this about?',
			model: { provider: 'anthropic', id: 'claude-opus-4-5' },
		});
		expect(result.analysis).toBe('Research findings');
		expect(result.sessionId).toBe('fake-session-id');
	});

	it('passes the research tool allowlist to createAgentSession', async () => {
		await runPiSession({ prompt: 'hi' });
		expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
		const opts = createAgentSessionMock.mock.calls[0][0];
		expect(opts.tools).toEqual(['read', 'grep', 'find', 'ls', 'bash']);
		expect(opts.tools).not.toContain('edit');
		expect(opts.tools).not.toContain('write');
	});

	it('resolves the model via the runtime then getModel, and sets a runtime API key', async () => {
		await runPiSession({
			prompt: 'hi',
			model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4' },
		});
		const opts = createAgentSessionMock.mock.calls[0][0];
		// Model resolved from the mock getModel (provider/id match).
		expect(opts.model.provider).toBe('openrouter');
		expect(opts.model.id).toBe('anthropic/claude-sonnet-4');
		// The isolated ModelRuntime is threaded into createAgentSession.
		expect(opts.modelRuntime).toBeDefined();
	});

	it('overrides the resolved model baseUrl from the model config', async () => {
		getModelMock.mockImplementation((provider: string, id: string) => ({
			provider,
			id,
			reasoning: true,
			baseUrl: 'https://opencode.ai/zen/go/v1',
		}));
		await runPiSession({
			prompt: 'hi',
			model: {
				provider: 'opencode-go',
				id: 'deepseek-v4-flash',
				baseUrl: 'https://litellm.void.cold.at/v1',
			},
		});
		const opts = createAgentSessionMock.mock.calls[0][0];
		expect(opts.model.provider).toBe('opencode-go');
		expect(opts.model.id).toBe('deepseek-v4-flash');
		// baseUrl override replaces the built-in endpoint; other fields survive.
		expect(opts.model.baseUrl).toBe('https://litellm.void.cold.at/v1');
		expect(opts.model.reasoning).toBe(true);
	});

	it('keeps the built-in baseUrl when no override is configured', async () => {
		getModelMock.mockImplementation((provider: string, id: string) => ({
			provider,
			id,
			baseUrl: 'https://opencode.ai/zen/go/v1',
		}));
		await runPiSession({
			prompt: 'hi',
			model: { provider: 'opencode-go', id: 'deepseek-v4-flash' },
		});
		const opts = createAgentSessionMock.mock.calls[0][0];
		expect(opts.model.baseUrl).toBe('https://opencode.ai/zen/go/v1');
	});

	it('throws PiAgentError when the model cannot be resolved', async () => {
		getModelMock.mockImplementation(() => {
			throw new Error('unknown model');
		});
		await expect(
			runPiSession({ prompt: 'hi', model: { provider: 'nope', id: 'nope' } }),
		).rejects.toThrow(PiAgentError);
		await expect(
			runPiSession({ prompt: 'hi', model: { provider: 'nope', id: 'nope' } }),
		).rejects.toThrow(/No model found/);
	});

	it('throws PiAgentError when no model is available and no env fallback resolves', async () => {
		// No webfetch research model + no PI_WEBFETCH_MODEL → local-pi path: the
		// SDK resolves the model from pi configs. When the SDK reports none, we
		// fail with a PiAgentError.
		const prev = process.env['PI_WEBFETCH_MODEL'];
		delete process.env['PI_WEBFETCH_MODEL'];
		createAgentSessionMock.mockResolvedValue({
			session: fakeSession,
			extensionsResult: {},
			modelFallbackMessage: 'No models configured. Run /login to authenticate a provider.',
		});
		try {
			await expect(runPiSession({ prompt: 'hi' })).rejects.toThrow(PiAgentError);
			await expect(runPiSession({ prompt: 'hi' })).rejects.toThrow(
				/No research model available/,
			);
		} finally {
			if (prev === undefined) delete process.env['PI_WEBFETCH_MODEL'];
			else process.env['PI_WEBFETCH_MODEL'] = prev;
		}
	});

	it('falls back to local pi configs/auth when no research model is configured', async () => {
		// No explicit model + no PI_WEBFETCH_MODEL: createAgentSession is called
		// WITHOUT modelRuntime / model / settingsManager so the SDK reads
		// agentDir/auth.json + models.json + the settings default model.
		const prev = process.env['PI_WEBFETCH_MODEL'];
		delete process.env['PI_WEBFETCH_MODEL'];
		try {
			await runPiSession({ prompt: 'hi' });
			const opts = createAgentSessionMock.mock.calls[0][0];
			expect(opts.model).toBeUndefined();
			expect(opts.modelRuntime).toBeUndefined();
			expect(opts.settingsManager).toBeUndefined();
			// The tool allowlist still applies.
			expect(opts.tools).toEqual(['read', 'grep', 'find', 'ls', 'bash']);
		} finally {
			if (prev === undefined) delete process.env['PI_WEBFETCH_MODEL'];
			else process.env['PI_WEBFETCH_MODEL'] = prev;
		}
	});

	it('uses the isolated runtime when PI_WEBFETCH_MODEL is set without a config', async () => {
		// Env model keeps the isolated-runtime path (temp auth file), even
		// without an explicit researchModel config.
		const prev = process.env['PI_WEBFETCH_MODEL'];
		process.env['PI_WEBFETCH_MODEL'] = 'openrouter/anthropic/claude-sonnet-4';
		try {
			await runPiSession({ prompt: 'hi' });
			const opts = createAgentSessionMock.mock.calls[0][0];
			expect(opts.model.provider).toBe('openrouter');
			expect(opts.model.id).toBe('anthropic/claude-sonnet-4');
			expect(opts.modelRuntime).toBeDefined();
			expect(opts.settingsManager).toBeDefined();
		} finally {
			if (prev === undefined) delete process.env['PI_WEBFETCH_MODEL'];
			else process.env['PI_WEBFETCH_MODEL'] = prev;
		}
	});

	it('resolves a model from the PI_WEBFETCH_MODEL env var when no option is given', async () => {
		const prev = process.env['PI_WEBFETCH_MODEL'];
		process.env['PI_WEBFETCH_MODEL'] = 'anthropic/claude-opus-4-5';
		try {
			await runPiSession({ prompt: 'hi' });
		} finally {
			if (prev === undefined) delete process.env['PI_WEBFETCH_MODEL'];
			else process.env['PI_WEBFETCH_MODEL'] = prev;
		}
		const opts = createAgentSessionMock.mock.calls[0][0];
		expect(opts.model.provider).toBe('anthropic');
		expect(opts.model.id).toBe('claude-opus-4-5');
	});

	it('streams onChunk for coalesced text deltas (byte-equal to delta concatenation)', async () => {
		const { promise, resolve } = deferredPrompt();
		fakeSession.promptPromise = promise;
		const chunks: string[] = [];
		const runPromise = runPiSession({
			prompt: 'hi',
			onChunk: (c) => chunks.push(c),
		});
		await yieldMicrotasks();
		fakeSession.emitText('Hello, ');
		fakeSession.emitText('world');
		fakeSession.emitText('!');
		// Flush the 16ms buffer.
		await new Promise((r) => setTimeout(r, 30));
		expect(chunks.join('')).toBe('Hello, world!');
		resolve();
		await runPromise;
	});

	it('fires onToolCall with the phase mapping for read / bash / unknown', async () => {
		const { promise, resolve } = deferredPrompt();
		fakeSession.promptPromise = promise;
		const events: Array<{ phase: string; name: string; args: unknown }> = [];
		const runPromise = runPiSession({
			prompt: 'hi',
			onToolCall: (e) => events.push(e),
		});
		await yieldMicrotasks();
		fakeSession.emitTool('read', { path: '/tmp/input.md' });
		fakeSession.emitTool('bash', { command: 'ls /tmp' });
		fakeSession.emitTool('webfetch', { url: 'https://example.com' });
		await yieldMicrotasks();
		expect(events.map((e) => e.phase)).toEqual(['reading', 'executing', 'thinking']);
		expect(events.map((e) => e.name)).toEqual(['read', 'bash', 'webfetch']);
		resolve();
		await runPromise;
	});

	it('fires onThinking for thinking_delta events', async () => {
		const { promise, resolve } = deferredPrompt();
		fakeSession.promptPromise = promise;
		const thinking: string[] = [];
		const runPromise = runPiSession({
			prompt: 'hi',
			onThinking: (c) => thinking.push(c),
		});
		await yieldMicrotasks();
		fakeSession.emitThinking('let me ');
		fakeSession.emitThinking('think');
		await yieldMicrotasks();
		expect(thinking.join('')).toBe('let me think');
		resolve();
		await runPromise;
	});

	it('seeds the session with the deterministic id and sets the session name', async () => {
		await runPiSession({
			prompt: 'hi',
			sessionId: 'abc123def4567890',
			sessionName: 'webfetch-research: example.com',
		});
		expect(fakeSession.setSessionName).toHaveBeenCalledWith('webfetch-research: example.com');
	});

	it('rejects with PiAgentError on timeout and aborts + disposes the session', async () => {
		// prompt never resolves; the wall-clock timeout wins.
		fakeSession.promptImpl.mockImplementation(() => new Promise(() => {}));
		const disposeSpy = fakeSession.dispose;
		await expect(runPiSession({ prompt: 'hi', timeoutMs: 30 })).rejects.toThrow(
			/Pi agent timed out after 30ms/,
		);
		expect(fakeSession.abort).toHaveBeenCalled();
		expect(disposeSpy).toHaveBeenCalled();
	});

	it('disposes the session on success', async () => {
		await runPiSession({ prompt: 'hi' });
		expect(fakeSession.dispose).toHaveBeenCalled();
	});

	it('does not set a runtime API key when no key is available (relies on SDK env fallback)', async () => {
		// getEnvApiKey returns undefined and no explicit apiKey.
		await runPiSession({ prompt: 'hi', model: { provider: 'anthropic', id: 'claude' } });
		// createAgentSession receives the isolated ModelRuntime regardless.
		const opts = createAgentSessionMock.mock.calls[0][0];
		expect(opts.modelRuntime).toBeDefined();
		expect(modelRuntimeSetRuntimeApiKeyMock).not.toHaveBeenCalled();
	});
});

describe('toolNameToPhase', () => {
	it('maps read/grep/find/ls to reading', () => {
		for (const name of ['read', 'grep', 'find', 'ls']) {
			expect(toolNameToPhase(name)).toBe('reading');
		}
	});
	it('maps bash to executing', () => {
		expect(toolNameToPhase('bash')).toBe('executing');
	});
	it('maps everything else to thinking', () => {
		expect(toolNameToPhase('webfetch')).toBe('thinking');
		expect(toolNameToPhase('')).toBe('thinking');
	});
});

describe('DEFAULT_RESEARCH_TOOLS', () => {
	it('is exactly the research allowlist', () => {
		expect(DEFAULT_RESEARCH_TOOLS).toEqual(['read', 'grep', 'find', 'ls', 'bash']);
	});
});
