/**
 * Browser large-page tests
 *
 * Regression for BUG-2026-06-06-JGCMZSET-YZOYE: the per-`get`
 * timeout in `BrowserManager.pickContentSource` used to be
 * capped at 5 s. Large pages (e.g. Wikipedia articles
 * > 200 KB) took longer than 5 s per `get html article|main`
 * call, the cap was hit, and the call fell through to the
 * static-fetch path. The user got a `Processed as: fallback`
 * with no `Provider:` line.
 *
 * The fix: the per-`get` timeout is the caller-supplied
 * `timeout` (30 s default). The global timeout is the only
 * budget owner. This test pins the new contract: a
 * 30 s-supplied `timeout` produces a 30 s exec-timeout on
 * the `get html article` call.
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

import { BrowserManager } from '../src/providers/internal/browser-manager.js';

beforeEach(() => {
	execAsyncMock.mockReset();
	// <body> HTML > 100 chars so the `pickContentSource`
	// body-fallback path is taken (we want to focus on the
	// timeout, not the selector cascade).
	execAsyncMock.mockResolvedValue('x'.repeat(500));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('BrowserManager — pickContentSource no longer caps at 5 s', () => {
	it('uses the caller-supplied timeout on `get html article`', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		// The default provider passes 30 s. The
		// `get html article` exec call must inherit that
		// timeout, not a 5 s cap.
		await m.extractHtml('https://en.wikipedia.org/wiki/Markdown', 'networkidle', 30_000);

		const articleCall = execAsyncMock.mock.calls.find(
			(c) =>
				c[0] === 'agent-browser' &&
				c[1]?.[0] === 'get' &&
				c[1]?.[1] === 'html' &&
				c[1]?.[2] === 'article',
		);
		expect(articleCall).toBeDefined();
		const opts = articleCall?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBe(30_000);
	});

	it('uses the caller-supplied timeout on `get html main`', async () => {
		const m = new BrowserManager({ sessionName: 'test:42' });
		// Make `article` return empty so the cascade falls
		// through to `main`. We want to assert the `main`
		// call's timeout, not the `article` one (covered by
		// the test above).
		execAsyncMock.mockImplementation(
			async (_cmd: string, args: string[]) => {
				if (args[0] === 'get' && args[1] === 'html' && args[2] === 'article') return '';
				return 'x'.repeat(500);
			},
		);
		await m.extractHtml('https://en.wikipedia.org/wiki/Pi', 'networkidle', 30_000);

		const mainCall = execAsyncMock.mock.calls.find(
			(c) =>
				c[0] === 'agent-browser' &&
				c[1]?.[0] === 'get' &&
				c[1]?.[1] === 'html' &&
				c[1]?.[2] === 'main',
		);
		expect(mainCall).toBeDefined();
		const opts = mainCall?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBe(30_000);
	});

	it('does NOT cap a 5 s caller timeout to anything below 5 s (back-compat with tests)', async () => {
		// Tests in `browser-tab-isolation.test.ts` pass 5 s.
		// The cap-removal must not over-cap: a 5 s caller's
		// value is honoured verbatim.
		const m = new BrowserManager({ sessionName: 'test:42' });
		await m.extractHtml('https://example.com', 'networkidle', 5_000);

		const articleCall = execAsyncMock.mock.calls.find(
			(c) =>
				c[0] === 'agent-browser' &&
				c[1]?.[0] === 'get' &&
				c[1]?.[1] === 'html' &&
				c[1]?.[2] === 'article',
		);
		expect(articleCall).toBeDefined();
		const opts = articleCall?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBe(5_000);
	});

	it('keeps the 5 s cap on `tab close` (different concern: not blowing past the caller budget)', async () => {
		// `tab close` keeps its 5 s cap. The cap on
		// `pickContentSource` was the bug; the cap on
		// `tab close` is intentional.
		const m = new BrowserManager({ sessionName: 'test:42' });
		await m.extractHtml('https://example.com', 'networkidle', 30_000);

		const closeCall = execAsyncMock.mock.calls.find(
			(c) => c[0] === 'agent-browser' && c[1]?.[0] === 'tab' && c[1]?.[1] === 'close',
		);
		expect(closeCall).toBeDefined();
		const opts = closeCall?.[2] as { timeout?: number } | undefined;
		// Cap is `min(timeout, 5_000)` = `min(30_000, 5_000)` = 5_000.
		expect(opts?.timeout).toBe(5_000);
	});
});
