/**
 * Browser tab isolation tests
 *
 * Regression for the 2026-06-06 review (finding 6 / 1): the
 * default provider used to keep a single `agent-browser` tab
 * alive across calls and skip `agent-browser open` when
 * `currentUrl === url`. Two problems:
 *
 * 1. If `agent-browser open` returned before the new page had
 *    committed, the subsequent `wait --load networkidle` could
 *    settle on the previous page.
 * 2. Two concurrent webfetch *processes* on the same host
 *    raced on the same global `agent-browser` instance.
 *
 * The v0.9.0 fix: per-process `AGENT_BROWSER_SESSION` and
 * per-fetch tab id (`crypto.randomUUID()`). The tab is closed
 * in `finally` regardless of success / failure. These tests
 * pin the new lifecycle without spawning a real browser
 * (the `agent-browser` calls are mocked at the exec layer).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execAsyncMock = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/process.js', () => ({
	execAsync: execAsyncMock,
	execAsyncFull: vi.fn(),
	ProcessMutex: class {},
	killProcessTree: vi.fn(),
	ExecAsyncError: class extends Error {},
}));

import { BrowserManager, deriveSessionName } from '../src/providers/internal/browser-manager.js';

beforeEach(() => {
	execAsyncMock.mockReset();
	// Default: every exec call returns an empty string. Tests
	// that need a specific body override individual calls.
	execAsyncMock.mockResolvedValue('');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('deriveSessionName', () => {
	it('is `${hostname}:${process.pid}` shaped', () => {
		const name = deriveSessionName();
		expect(name).toMatch(/^.+:\d+$/);
		expect(name.endsWith(`:${process.pid}`)).toBe(true);
	});

	it('returns the same value across calls (stable for the process lifetime)', () => {
		expect(deriveSessionName()).toBe(deriveSessionName());
	});
});

describe('BrowserManager — per-process session', () => {
	it('exposes a stable sessionName', () => {
		const m = new BrowserManager();
		expect(m.sessionName).toBe(deriveSessionName());
		expect(new BrowserManager().sessionName).toBe(m.sessionName);
	});

	it('passes AGENT_BROWSER_SESSION=sessionName on every exec call', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		await m.close();
		// `close()` runs one exec call (agent-browser close).
		expect(execAsyncMock).toHaveBeenCalled();
		const opts = execAsyncMock.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
		expect(opts?.env?.AGENT_BROWSER_SESSION).toBe('test:42');
	});
});

describe('BrowserManager — per-fetch tab', () => {
	it('opens a fresh tab via `tab new <url> --label <id>` and closes it in finally', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		// <body> HTML must be > 100 chars so `pickContentSource` returns body
		// (we want to keep the test focused on the tab lifecycle, not the
		// selector cascade).
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'tab' && args[1] === 'new') {
					return '';
				}
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'body') {
					return 'x'.repeat(500);
				}
				return '';
			},
		);

		await m.extractHtml('https://example.com', 'networkidle', 5_000);

		// 1. `tab new` was called with --label <id>
		const openCall = execAsyncMock.mock.calls.find(
			(c) => c[0] === 'agent-browser' && c[1]?.[0] === 'tab' && c[1]?.[1] === 'new',
		);
		expect(openCall).toBeDefined();
		expect(openCall?.[1]?.[2]).toBe('https://example.com');
		expect(openCall?.[1]).toContain('--label');
		const tabId = openCall?.[1]?.[4];
		expect(tabId).toMatch(/^webfetch-/);

		// 2. `tab close <id>` was called for the same id (in finally)
		const closeCall = execAsyncMock.mock.calls.find(
			(c) => c[0] === 'agent-browser' && c[1]?.[0] === 'tab' && c[1]?.[1] === 'close',
		);
		expect(closeCall).toBeDefined();
		expect(closeCall?.[1]?.[2]).toBe(tabId);
	});

	it('closes the tab even when `tab new` throws', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		execAsyncMock.mockImplementation(async (_cmd: string, args: string[]) => {
			if (args[0] === 'tab' && args[1] === 'new') {
				throw new Error('boom');
			}
			return '';
		});

		await expect(m.extractHtml('https://example.com', 'networkidle', 5_000)).rejects.toThrow(
			'boom',
		);

		// The `tab close` call still happened (in the finally block).
		const closeCall = execAsyncMock.mock.calls.find(
			(c) => c[0] === 'agent-browser' && c[1]?.[0] === 'tab' && c[1]?.[1] === 'close',
		);
		expect(closeCall).toBeDefined();
	});

	it('uses a unique tab id per call (no reuse)', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		execAsyncMock.mockResolvedValue('x'.repeat(500));

		await m.extractHtml('https://example.com', 'networkidle', 5_000);
		await m.extractHtml('https://example.org', 'networkidle', 5_000);

		const openCalls = execAsyncMock.mock.calls.filter(
			(c) => c[0] === 'agent-browser' && c[1]?.[0] === 'tab' && c[1]?.[1] === 'new',
		);
		expect(openCalls).toHaveLength(2);
		const id1 = openCalls[0]?.[1]?.[4];
		const id2 = openCalls[1]?.[1]?.[4];
		expect(id1).toMatch(/^webfetch-/);
		expect(id2).toMatch(/^webfetch-/);
		expect(id1).not.toBe(id2);
	});
});

describe('BrowserManager — concurrent BrowserManagers in the same process', () => {
	it('each manager has its own sessionName (and tab ids do not collide)', async () => {
		const a = new BrowserManager({ sessionName: 'A' });
		const b = new BrowserManager({ sessionName: 'B' });
		expect(a.sessionName).toBe('A');
		expect(b.sessionName).toBe('B');
		expect(a.sessionName).not.toBe(b.sessionName);

		execAsyncMock.mockResolvedValue('x'.repeat(500));

		await Promise.all([
			a.extractHtml('https://a.example.com', 'networkidle', 5_000),
			b.extractHtml('https://b.example.com', 'networkidle', 5_000),
		]);

		// Both managers spawned a `tab new` with their own
		// sessionName, and the tab ids are distinct.
		const openCalls = execAsyncMock.mock.calls.filter(
			(c) => c[0] === 'agent-browser' && c[1]?.[0] === 'tab' && c[1]?.[1] === 'new',
		);
		expect(openCalls).toHaveLength(2);
		const envA = (openCalls[0]?.[2] as { env?: Record<string, string> } | undefined)?.env
			?.AGENT_BROWSER_SESSION;
		const envB = (openCalls[1]?.[2] as { env?: Record<string, string> } | undefined)?.env
			?.AGENT_BROWSER_SESSION;
		expect(envA).toBe('A');
		expect(envB).toBe('B');

		const idA = openCalls[0]?.[1]?.[4];
		const idB = openCalls[1]?.[1]?.[4];
		expect(idA).not.toBe(idB);
	});
});

describe('BrowserManager — content source cascade', () => {
	it('returns the first non-empty of article / main / body', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		// article is empty, main returns the real HTML (>100 chars)
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'article') return '';
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'main')
					return 'main-html'.repeat(20);
				return '';
			},
		);

		const result = await m.extractHtml('https://example.com', 'networkidle', 5_000);
		expect(result.contentSource).toBe('main');
	});

	it('falls back to body when article and main are empty', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'article') return '';
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'main') return '';
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'body')
					return 'body-html'.repeat(20);
				return '';
			},
		);

		const result = await m.extractHtml('https://example.com', 'networkidle', 5_000);
		expect(result.contentSource).toBe('body');
	});
});
