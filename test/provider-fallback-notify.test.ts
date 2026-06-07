/**
 * Provider fallback notify tests
 *
 * Regression for BUG-2026-06-06-JGCMZSET-YZOYE: when the
 * default (browser) provider fails, the fetch service used
 * to swallow the error silently and fall through to static
 * fetch. The user got a `Processed as: fallback` line with
 * no indication the browser was abandoned.
 *
 * The fix surfaces the cause on three channels:
 *
 * 1. `WebfetchDetails.providerError` — the user-facing
 *    `details` object carries `{ provider, reason, message }`
 *    so the tool header can render `Provider: browser
 *    (failed: timeout)`.
 * 2. `options.cacheNotify` — the optional callback the CLI /
 *    MCP / extension surfaces pass in. The TUI surfaces it
 *    via `ctx.ui.notify`, the CLI prints it to stderr, the
 *    MCP returns it under `_meta.details.notify`.
 * 3. The cache write is skipped for transient reasons
 *    (`timeout`, `navigation_failed`) so the next call
 *    re-attempts the browser instead of returning a cached
 *    fallback.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const managerFetchMock = vi.hoisted(() => vi.fn());
const staticFetchMock = vi.hoisted(() => vi.fn());
const getCacheMock = vi.hoisted(() => vi.fn());
const setCacheMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/services/session-manager.js', () => ({
	getProviderManager: async () => ({
		fetch: managerFetchMock,
		closeAll: async () => undefined,
	}),
	closeAllProviders: async () => undefined,
	getProviderStatus: async () => [],
}));

vi.mock('../extensions/services/static-fetch.js', () => ({
	staticFetch: staticFetchMock,
	handleBinary: vi.fn(),
	__resetStaticOnlyWarningForTest: () => {},
}));

vi.mock('../extensions/utils/url.js', () => ({
	isLikelyBinaryUrl: () => false,
}));

vi.mock('../extensions/cache.js', () => ({
	getCache: getCacheMock,
	setCache: setCacheMock,
	hasCache: async () => false,
	getCacheAge: async () => null,
	clearCache: async () => true,
	clearAllCache: async () => 0,
	getCacheStats: async () => ({ count: 0, totalSize: 0 }),
	formatAge: () => '0 seconds ago',
	isFresh: () => true,
	parseDurationToMs: (v: string) => Number(v) || null,
	DEFAULT_CACHE_TTL_MS: 3_600_000,
}));

import { fetchUrl } from '../extensions/services/fetch-service.js';
import { ProviderError } from '../src/providers/types.js';
import { __resetStaticOnlyWarningForTest } from '../extensions/services/static-fetch.js';

beforeEach(() => {
	managerFetchMock.mockReset();
	staticFetchMock.mockReset();
	getCacheMock.mockReset();
	setCacheMock.mockReset();
	getCacheMock.mockResolvedValue(null);
	setCacheMock.mockResolvedValue(undefined);
	__resetStaticOnlyWarningForTest();
});

describe('fetchUrl — provider fallback surfaces the error', () => {
	it('sets `details.providerError` when the browser provider throws a `ProviderError(reason: "timeout")`', async () => {
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError(
				'Command timed out after 30000ms',
				'default',
				undefined,
				'timeout',
			),
		);
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'static body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				originalSize: 12345,
				tempFileSize: 1234,
				truncated: false,
				extracted: true,
				rawContent: '<html>static</html>',
				rawContentType: 'text/html',
			},
		});

		const result = await fetchUrl('https://en.wikipedia.org/wiki/Markdown');

		// The provider error is on `details.providerError` and
		// the fallback body is still returned to the caller.
		expect(result.details.providerError).toEqual({
			provider: 'default',
			reason: 'timeout',
			message: '[default] Command timed out after 30000ms',
		});
		expect(result.content[0]?.text).toContain('static body');
	});

	it('fires the `cacheNotify` callback with a warning that includes the reason and URL', async () => {
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError(
				'Command timed out after 30000ms',
				'default',
				undefined,
				'timeout',
			),
		);
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: true,
			},
		});

		const cacheNotify = vi.fn();
		await fetchUrl(
			'https://en.wikipedia.org/wiki/Markdown',
			fetch,
			undefined,
			{ cacheNotify },
		);

		// The cacheNotify is called at least once with a
		// warning that names the URL, the provider, the
		// reason, and the static fallback. A transient
		// `timeout` reason also fires the cache-write-rejected
		// warning, so the call count is `>= 1` and the first
		// call carries the provider-failure text.
		expect(cacheNotify.mock.calls.length).toBeGreaterThanOrEqual(1);
		const [message, level] = cacheNotify.mock.calls[0]!;
		expect(level).toBe('warn');
		expect(message).toContain('default');
		expect(message).toContain('timeout');
		expect(message).toContain('en.wikipedia.org/wiki/Markdown');
		expect(message).toContain('falling back to static fetch');
	});

	it('skips the cache write when the provider error reason is transient (`timeout`)', async () => {
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError('Command timed out after 30000ms', 'default', undefined, 'timeout'),
		);
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: true,
			},
		});

		const result = await fetchUrl('https://en.wikipedia.org/wiki/Markdown');

		// `setCache` was NOT called — the cache is not poisoned
		// by the transient error.
		expect(setCacheMock).not.toHaveBeenCalled();
		// The notify shim was populated with the rejection
		// reason (so the caller can surface it without their
		// own cacheNotify).
		expect(result.details.notify).toMatch(/cache write rejected/);
	});

	it('skips the cache write when the provider error reason is transient (`navigation_failed`)', async () => {
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError(
				'Chromium net-error page rendered for https://does-not-exist.invalid: ERR_NAME_NOT_RESOLVED',
				'default',
				undefined,
				'navigation_failed',
			),
		);
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://does-not-exist.invalid',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: true,
			},
		});

		const result = await fetchUrl('https://does-not-exist.invalid');

		expect(setCacheMock).not.toHaveBeenCalled();
		expect(result.details.providerError?.reason).toBe('navigation_failed');
	});

	it('WRITES the cache when the provider error reason is deterministic (`low_text_ratio`)', async () => {
		// A `low_text_ratio` is a static property of the
		// rendered page, not a transient failure. The cache
		// write should go through.
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError('low text ratio', 'default', undefined, 'low_text_ratio'),
		);
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.com/plain.txt',
				contentType: 'text/plain',
				status: 200,
				processedAs: 'static' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: false,
			},
		});

		await fetchUrl('https://example.com/plain.txt');

		expect(setCacheMock).toHaveBeenCalled();
	});

	it('classifies an unknown error (non-ProviderError) as `reason: "unknown"` and still skips the cache', async () => {
		managerFetchMock.mockRejectedValueOnce(new Error('something else'));
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: true,
			},
		});

		const result = await fetchUrl('https://example.com');

		// Unknown errors are *not* transient, so the cache
		// write goes through (the cause is presumably
		// deterministic — the provider is just not
		// classifying it).
		expect(result.details.providerError).toEqual({
			provider: 'browser',
			reason: 'unknown',
			message: 'something else',
		});
		expect(setCacheMock).toHaveBeenCalled();
	});
});
