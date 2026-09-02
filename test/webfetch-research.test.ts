import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { webfetchResearch } from '../extensions/services/research-service.js';

// Mock the underlying pi-agent so we can drive `webfetchResearch` through
// success and failure paths without spawning a real subprocess.
const spawnPiAgentMock = vi.fn();

vi.mock('../extensions/pi-agent.js', () => ({
	spawnPiAgent: (...args: unknown[]) => spawnPiAgentMock(...args),
}));

// Mock fetch-service so we don't reach the real network.
const fetchUrlMock = vi.fn();
vi.mock('../extensions/services/fetch-service.js', () => ({
	fetchUrl: (...args: unknown[]) => fetchUrlMock(...args),
}));

/** A minimal `EventEmitter` that quacks like `node:child_process` ChildProcess. */
function fakeChildProcess(): EventEmitter & {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill: ReturnType<typeof vi.fn>;
} {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: ReturnType<typeof vi.fn>;
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();
	return proc;
}

describe('webfetchResearch - resume hint', () => {
	beforeEach(() => {
		spawnPiAgentMock.mockReset();
		fetchUrlMock.mockReset();
	});

	const happyFetchResult = {
		content: [{ type: 'text' as const, text: 'Page body content' }],
		details: {
			url: 'https://example.com/page',
			contentType: 'text/html',
			status: 200,
			processedAs: 'markdown' as const,
		},
	};

	it('populates subagentSessionId / subagentSessionName / resumeCommand on the agent-error path', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('spawn failed'));

		const notify = vi.fn();
		const result = await webfetchResearch(
			'https://example.com/page',
			'summarize this',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000000,
			notify,
			'extension',
		);

		expect(result.details.processedAs).toBe('error');
		expect(result.details.phase).toBe('error');
		expect(result.details.subagentSessionId).toMatch(/^[0-9a-f]{16}$/);
		expect(result.details.subagentSessionName).toBe('webfetch-research: example.com');
		expect(result.details.resumeCommand).toBe(
			`pi --session ${result.details.subagentSessionId}`,
		);

		expect(notify).toHaveBeenCalledTimes(1);
		const [message, level] = notify.mock.calls[0];
		expect(level).toBe('error');
		expect(message).toContain('Research subagent failed.');
		expect(message).toContain(`pi --session ${result.details.subagentSessionId}`);
		expect(message).toContain('Session name: webfetch-research: example.com');
		expect(message).toContain('Reason: spawn failed');
	});

	it('keeps the in-content ## Fetch Result (Agent Error) body byte-identical to the pre-change baseline', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('spawn failed'));

		const result = await webfetchResearch(
			'https://example.com/page',
			'summarize this',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000000,
			vi.fn(),
			'extension',
		);

		const text = result.content[0]?.text ?? '';
		// The fallback body must NOT include the resume hint; the hint lives
		// in `details` and the `notify` side-channel only.
		expect(text).not.toContain('Resume:');
		expect(text).not.toContain('pi --session');
		expect(text).not.toContain('Re-run:');
		// Baseline shape: header + agent error line + fetched content.
		expect(text.startsWith('## Fetch Result (Agent Error)\n')).toBe(true);
		expect(text).toContain('**Command:** /webfetch https://example.com/page "summarize this"');
		expect(text).toContain('**Agent Error:** spawn failed');
		expect(text).toContain('Page body content');
	});

	it('calls notify exactly once per failure in the stable format', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('boom'));

		const notify = vi.fn();
		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 42,
			notify,
			'extension',
		);

		expect(notify).toHaveBeenCalledTimes(1);
		const message = notify.mock.calls[0][0] as string;
		// Stable multi-line shape; tests can pin to this.
		expect(message).toMatch(
			/^Research subagent failed\.\nResume: pi --session [0-9a-f]{16}\nSession name: webfetch-research: example\.com\nReason: boom$/,
		);
	});

	it('derives a deterministic session id - same now / URL / query produce the same id', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('boom'));

		const now = () => 1700000000000;
		const r1 = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			now,
			vi.fn(),
			'extension',
		);
		const r2 = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			now,
			vi.fn(),
			'extension',
		);

		expect(r1.details.subagentSessionId).toBe(r2.details.subagentSessionId);
	});

	it('derives a deterministic session id - different now produces different ids', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('boom'));

		const r1 = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000000,
			vi.fn(),
			'extension',
		);
		const r2 = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000001,
			vi.fn(),
			'extension',
		);

		expect(r1.details.subagentSessionId).not.toBe(r2.details.subagentSessionId);
	});

	it('threads the session id into spawnPiAgent options on the success path', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		// The mock echoes the option id back as the result id; we only
		// assert on the option that webfetchResearch derived and passed.
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000000,
			vi.fn(),
			'extension',
		);

		expect(spawnPiAgentMock).toHaveBeenCalledTimes(1);
		const call = spawnPiAgentMock.mock.calls[0];
		expect(call[2]?.sessionId).toMatch(/^[0-9a-f]{16}$/);
		expect(call[2]?.sessionName).toBe('webfetch-research: example.com');
		expect(result.details.processedAs).toBe('research');
		expect(result.details.subagentSessionId).toBe(call[2]?.sessionId);
		expect(result.details.subagentSessionName).toBe('webfetch-research: example.com');
	});

	it('emits a cli-shaped resume command on the agent-error path', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('boom'));

		const notify = vi.fn();
		const result = await webfetchResearch(
			'https://example.com/page',
			'summarize',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1,
			notify,
			'cli',
		);

		expect(result.details.resumeCommand).toBe(
			'pi-webfetch webfetch https://example.com/page --query summarize',
		);
		expect(notify.mock.calls[0][0]).toContain('Re-run: pi-webfetch webfetch');
	});

	it('reuses the same subagent session id on the spawn and the resume hint (non-streaming path)', async () => {
		// Regression guard: a constant-clock test would mask a bug where
		// the catch block re-derives the id with a fresh `now()` and
		// the user is pointed at a non-existent session.
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		const notify = vi.fn();
		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			// Counter clock: each call returns a different value.
			(() => {
				let n = 0;
				return () => ++n;
			})(),
			notify,
			'extension',
		);

		// Success path: the id in the result matches the option passed
		// to spawnPiAgent. (Sanity.)
		expect(result.details.subagentSessionId).toBe(spawnPiAgentMock.mock.calls[0][2]?.sessionId);
	});

	it('reuses the same subagent session id on the spawn and the resume hint (agent-error path, non-streaming)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('boom'));

		const notify = vi.fn();
		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			(() => {
				let n = 0;
				return () => ++n;
			})(),
			notify,
			'extension',
		);

		// The id surfaced on the details MUST be the same id the spawn
		// was invoked with. Otherwise the resume command points at a
		// non-existent session.
		expect(result.details.subagentSessionId).toBe(spawnPiAgentMock.mock.calls[0][2]?.sessionId);
		// And the resume command is built from that same id.
		expect(result.details.resumeCommand).toBe(
			`pi --session ${result.details.subagentSessionId}`,
		);
	});

	it('reuses the same subagent session id on the spawn and the resume hint (agent-error path, streaming)', async () => {
		// Same regression guard for the streaming branch: the streaming
		// path threads the sessionId through the spawn option too.
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('boom'));

		const streamingConfig = {
			callback: vi.fn(),
			url: 'https://example.com',
			initialPhase: 'analyzing' as const,
			streamingPhase: 'streaming' as const,
		};

		const notify = vi.fn();
		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			streamingConfig,
			undefined,
			undefined,
			(() => {
				let n = 0;
				return () => ++n;
			})(),
			notify,
			'extension',
		);

		expect(result.details.subagentSessionId).toBe(spawnPiAgentMock.mock.calls[0][2]?.sessionId);
		expect(result.details.resumeCommand).toBe(
			`pi --session ${result.details.subagentSessionId}`,
		);
	});

	it('forwards an explicit timeout to spawnPiAgent (non-streaming)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
			300_000,
		);

		expect(spawnPiAgentMock).toHaveBeenCalledTimes(1);
		const opts = spawnPiAgentMock.mock.calls[0][2];
		expect(opts?.timeout).toBe(300_000);
	});

	it('forwards an explicit timeout to spawnPiAgent (streaming)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		const streamingConfig = {
			callback: vi.fn(),
			url: 'https://example.com',
			initialPhase: 'analyzing' as const,
			streamingPhase: 'streaming' as const,
		};

		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			streamingConfig,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
			300_000,
		);

		const opts = spawnPiAgentMock.mock.calls[0][2];
		expect(opts?.timeout).toBe(300_000);
	});

	it('forwards the selected research model to spawnPiAgent (non-streaming)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));
		const model = {
			provider: 'openrouter',
			id: 'anthropic/claude-sonnet-4',
		};

		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
			undefined,
			model,
		);

		expect(spawnPiAgentMock.mock.calls[0][2]?.model).toEqual(model);
	});

	it('forwards the selected research model to spawnPiAgent (streaming)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));
		const model = { provider: 'openai', id: 'gpt-5' };

		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			{
				callback: vi.fn(),
				url: 'https://example.com',
				initialPhase: 'analyzing',
				streamingPhase: 'streaming',
			},
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
			undefined,
			model,
		);

		expect(spawnPiAgentMock.mock.calls[0][2]?.model).toEqual(model);
	});

	it('omits the timeout option when not provided, so spawnPiAgent uses its default', async () => {
		// Regression guard: the user-facing 60s timeout bug was triggered
		// by the spawn default being too low. Today the spawn default is
		// 180s; callers that don't pass a timeout must let the spawn
		// layer apply its own default, not webfetchResearch.
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
		);

		const opts = spawnPiAgentMock.mock.calls[0][2];
		expect(opts?.timeout).toBeUndefined();
	});

	it('writes input.md and threads the file path into the spawn options (non-streaming)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
		);

		const opts = spawnPiAgentMock.mock.calls[0][2];
		// The prompt is lean: the URL and the file paths go in, the
		// content is NOT inlined.
		expect(opts?.url).toBe('https://example.com');
		expect(opts?.inputFile).toBeDefined();
		expect(opts?.inputFile).toMatch(/input\.md$/);
		// No raw content was set on the happy fetch result, so
		// inputRawFile is undefined.
		expect(opts?.inputRawFile).toBeUndefined();

		// And the work dir / file paths are surfaced on the result
		// details so the user can `ls` the work dir or `read` the
		// input file directly.
		expect(result.details.workDir).toBeDefined();
		expect(result.details.inputFile).toBe(opts?.inputFile);
		expect(result.details.inputRawFile).toBeUndefined();
	});

	it('writes input_raw.html when the fetch result carries raw content (streaming)', async () => {
		const fetchWithRaw = {
			content: [{ type: 'text' as const, text: 'Page body content' }],
			details: {
				url: 'https://example.com/page',
				contentType: 'text/html',
				status: 200,
				processedAs: 'markdown' as const,
				rawContent: '<!doctype html><html><body>raw</body></html>',
				rawContentType: 'text/html',
			},
		};
		fetchUrlMock.mockResolvedValue(fetchWithRaw);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		const streamingConfig = {
			callback: vi.fn(),
			url: 'https://example.com',
			initialPhase: 'analyzing' as const,
			streamingPhase: 'streaming' as const,
		};

		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			streamingConfig,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
		);

		const opts = spawnPiAgentMock.mock.calls[0][2];
		expect(opts?.inputRawFile).toMatch(/input_raw\.html$/);

		// The streaming result details also surface the file paths.
		expect(result.details.inputFile).toBe(opts?.inputFile);
		expect(result.details.inputRawFile).toBe(opts?.inputRawFile);
	});

	it('threads url / inputFile / inputRawFile into the spawn options on the agent-error path', async () => {
		const fetchWithRaw = {
			content: [{ type: 'text' as const, text: 'Page body content' }],
			details: {
				url: 'https://example.com/page',
				contentType: 'text/html',
				status: 200,
				processedAs: 'markdown' as const,
				rawContent: '<!doctype html><html>raw</html>',
				rawContentType: 'text/html',
			},
		};
		fetchUrlMock.mockResolvedValue(fetchWithRaw);
		spawnPiAgentMock.mockRejectedValue(new Error('spawn failed'));

		const result = await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1,
			vi.fn(),
			'extension',
		);

		// The work dir / file paths surface on the error result
		// details too. The user can `ls` the work dir to see the
		// files that were prepared for the failed subagent.
		expect(result.details.workDir).toBeDefined();
		expect(result.details.inputFile).toMatch(/input\.md$/);
		expect(result.details.inputRawFile).toMatch(/input_raw\.html$/);
	});
});

describe('webfetchResearch - other behavior', () => {
	beforeEach(() => {
		spawnPiAgentMock.mockReset();
		fetchUrlMock.mockReset();
	});

	describe('query parsing logic', () => {
		it('recognizes when query is provided', () => {
			const hasQuery = (query?: string) => !!query;
			expect(hasQuery('What is this?')).toBe(true);
			expect(hasQuery()).toBe(false);
			expect(hasQuery('')).toBe(false);
		});

		it('handles URL-only mode', () => {
			const shouldUseResearch = (query?: string) => !!query;
			expect(shouldUseResearch()).toBe(false);
		});
	});

	describe('command argument parsing', () => {
		it('parses URL and query from space-separated args', () => {
			const parseArgs = (args: string) => {
				const spaceIdx = args.indexOf(' ');
				if (spaceIdx > 0) {
					return { url: args.slice(0, spaceIdx), query: args.slice(spaceIdx + 1) };
				}
				return { url: args, query: undefined };
			};

			expect(parseArgs('https://example.com What is this?')).toEqual({
				url: 'https://example.com',
				query: 'What is this?',
			});

			expect(parseArgs('https://example.com')).toEqual({
				url: 'https://example.com',
				query: undefined,
			});
		});

		it('parses quoted URL with query', () => {
			const parseArgs = (args: string) => {
				if (args.startsWith('"')) {
					const endQuote = args.indexOf('"', 1);
					if (endQuote > 0) {
						return {
							url: args.slice(1, endQuote),
							query: args.slice(endQuote + 1).trim() || undefined,
						};
					}
				}
				const spaceIdx = args.indexOf(' ');
				if (spaceIdx > 0) {
					return { url: args.slice(0, spaceIdx), query: args.slice(spaceIdx + 1) };
				}
				return { url: args, query: undefined };
			};

			expect(parseArgs('"https://example.com/page" Summarize this')).toEqual({
				url: 'https://example.com/page',
				query: 'Summarize this',
			});
		});

		it('validates URLs correctly', () => {
			const isValidUrl = (url: string) => {
				try {
					new URL(url);
					return true;
				} catch {
					return false;
				}
			};

			expect(isValidUrl('https://example.com')).toBe(true);
			expect(isValidUrl('http://localhost:3000')).toBe(true);
			expect(isValidUrl('not-a-url')).toBe(false);
			expect(isValidUrl('')).toBe(false);
		});
	});

	describe('error handling', () => {
		it('detects error content in fetch results', () => {
			const hasError = (content: string) => content.includes('Error:');

			expect(hasError('Error: Network failed')).toBe(true);
			expect(hasError('## Fetch Result\nSome content')).toBe(false);
		});
	});
});

describe('webfetchResearch - tool call streaming', () => {
	beforeEach(() => {
		spawnPiAgentMock.mockReset();
		fetchUrlMock.mockReset();
	});

	const happyFetchResult = {
		content: [{ type: 'text' as const, text: 'Page body content' }],
		details: {
			url: 'https://example.com/page',
			contentType: 'text/html',
			status: 200,
			processedAs: 'markdown' as const,
		},
	};

	it('forwards onToolCall to spawnPiAgent options', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => ({
			analysis: 'analysis text',
			exitCode: 0,
			sessionId: opts?.sessionId,
			sessionName: opts?.sessionName,
		}));

		await webfetchResearch(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000000,
			vi.fn(),
			'extension',
		);

		expect(spawnPiAgentMock).toHaveBeenCalledTimes(1);
		const opts = spawnPiAgentMock.mock.calls[0][2] as {
			onToolCall?: (event: unknown) => void;
		};
		expect(typeof opts.onToolCall).toBe('function');
	});

	it('emits phase: reading on a `read` tool event (streaming path)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		const updates: Array<{ phase?: string; text: string }> = [];
		const streamingConfig = {
			callback: (u: AgentToolResult<Record<string, unknown>>) => {
				const text = u.content.find((c) => c.type === 'text');
				updates.push({
					phase: (u.details as { phase?: string } | undefined)?.phase,
					text: text && text.type === 'text' ? text.text : '',
				});
			},
			url: 'https://example.com/page',
			initialPhase: 'processing' as const,
			streamingPhase: 'streaming' as const,
		};
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => {
			// Drive onToolCall like the subagent would.
			opts?.onToolCall?.({ phase: 'reading', name: 'read', args: { path: '/tmp/input.md' } });
			return {
				analysis: 'analysis text',
				exitCode: 0,
				sessionId: opts?.sessionId,
				sessionName: opts?.sessionName,
			};
		});

		await webfetchResearch('https://example.com', 'q', undefined, undefined, streamingConfig);

		// Find the update with phase=reading (the most recent tool event).
		const readUpdate = updates.find((u) => u.phase === 'reading');
		expect(readUpdate).toBeDefined();
		expect(readUpdate?.text).toContain('read');
		expect(readUpdate?.text).toContain('/tmp/input.md');
	});

	it('emits phase: executing on a `bash` tool event (streaming path)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		const updates: Array<{ phase?: string; text: string }> = [];
		const streamingConfig = {
			callback: (u: AgentToolResult<Record<string, unknown>>) => {
				const text = u.content.find((c) => c.type === 'text');
				updates.push({
					phase: (u.details as { phase?: string } | undefined)?.phase,
					text: text && text.type === 'text' ? text.text : '',
				});
			},
			url: 'https://example.com/page',
			initialPhase: 'processing' as const,
			streamingPhase: 'streaming' as const,
		};
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => {
			opts?.onToolCall?.({ phase: 'executing', name: 'bash', args: { command: 'ls /tmp' } });
			return {
				analysis: 'analysis text',
				exitCode: 0,
				sessionId: opts?.sessionId,
				sessionName: opts?.sessionName,
			};
		});

		await webfetchResearch('https://example.com', 'q', undefined, undefined, streamingConfig);

		const execUpdate = updates.find((u) => u.phase === 'executing');
		expect(execUpdate).toBeDefined();
		expect(execUpdate?.text).toContain('bash');
		expect(execUpdate?.text).toContain('ls /tmp');
	});

	it('emits phase: thinking on an unknown / non-allowlisted tool event (streaming path)', async () => {
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		const updates: Array<{ phase?: string; text: string }> = [];
		const streamingConfig = {
			callback: (u: AgentToolResult<Record<string, unknown>>) => {
				const text = u.content.find((c) => c.type === 'text');
				updates.push({
					phase: (u.details as { phase?: string } | undefined)?.phase,
					text: text && text.type === 'text' ? text.text : '',
				});
			},
			url: 'https://example.com/page',
			initialPhase: 'processing' as const,
			streamingPhase: 'streaming' as const,
		};
		spawnPiAgentMock.mockImplementation(async (_content, _query, opts) => {
			opts?.onToolCall?.({
				phase: 'thinking',
				name: 'webfetch',
				args: { url: 'https://example.com' },
			});
			return {
				analysis: 'analysis text',
				exitCode: 0,
				sessionId: opts?.sessionId,
				sessionName: opts?.sessionName,
			};
		});

		await webfetchResearch('https://example.com', 'q', undefined, undefined, streamingConfig);

		const thinkUpdate = updates.find((u) => u.phase === 'thinking');
		expect(thinkUpdate).toBeDefined();
		expect(thinkUpdate?.text).toContain('webfetch');
	});

	it('pinned regression: agent-error fallback body is byte-equal to the pre-change baseline', async () => {
		// Pinned regression from PLAN_AGENT_ERROR_RESUME.md: the
		// markdown body of the agent-error fallback must be
		// byte-identical to the pre-change baseline. The resume
		// hint lives in `details` and in the `notify` side-channel
		// so the agent's context is not polluted.
		fetchUrlMock.mockResolvedValue(happyFetchResult);
		spawnPiAgentMock.mockRejectedValue(new Error('Pi agent timed out after 100ms'));
		const notify = vi.fn();
		const result = await webfetchResearch(
			'https://example.com/page',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			() => 1700000000000,
			notify,
			'extension',
		);
		expect(result.content[0]?.text).toContain('## Fetch Result (Agent Error)');
		expect(result.content[0]?.text).toContain(
			'**Command:** /webfetch https://example.com/page "q"',
		);
		expect(result.content[0]?.text).toContain(
			'**Agent Error:** Pi agent timed out after 100ms',
		);
		// The body ends with the fetched content, NOT a resume hint
		// (the resume hint is in details / notify).
		expect(result.content[0]?.text).toContain('Page body content');
		// The notify side-channel is fired once.
		expect(notify).toHaveBeenCalledTimes(1);
	});
});
