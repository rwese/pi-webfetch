import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
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
		expect(result.details.resumeCommand).toBe(`pi --session ${result.details.subagentSessionId}`);

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
		expect(message).toMatch(/^Research subagent failed\.\nResume: pi --session [0-9a-f]{16}\nSession name: webfetch-research: example\.com\nReason: boom$/);
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
		expect(result.details.subagentSessionId).toBe(
			spawnPiAgentMock.mock.calls[0][2]?.sessionId,
		);
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
		expect(result.details.subagentSessionId).toBe(
			spawnPiAgentMock.mock.calls[0][2]?.sessionId,
		);
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

		expect(result.details.subagentSessionId).toBe(
			spawnPiAgentMock.mock.calls[0][2]?.sessionId,
		);
		expect(result.details.resumeCommand).toBe(
			`pi --session ${result.details.subagentSessionId}`,
		);
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
