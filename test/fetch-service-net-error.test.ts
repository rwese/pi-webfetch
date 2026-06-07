/**
 * Fetch service net-error tests
 *
 * End-to-end coverage for BUG-2026-06-06-JGCMZSNR-YZOYE:
 * when the default (browser) provider throws a
 * `ProviderError` with `reason: 'navigation_failed'` (the
 * Chromium net-error page was rendered), the fetch service
 * must:
 *
 * 1. Fall back to static fetch.
 * 2. Surface the error on `details.providerError`.
 * 3. Fire the `cacheNotify` warning channel.
 * 4. NOT write the fallback result to the cache (a
 *    `navigation_failed` reason is transient).
 *
 * The provider layer is mocked so the test runs in CI
 * without an actual browser. The real flow is the same:
 * a `ProviderError(reason: 'navigation_failed')` is
 * thrown in the provider, the fetch service catches it,
 * classifies it, and runs the static fallback.
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

describe('fetchUrl — Chromium net-error fallback (BUG-2026-06-06-JGCMZSNR-YZOYE)', () => {
	it('falls back to static fetch and surfaces the error on `details.providerError`', async () => {
		// The default provider threw because the rendered
		// body contained a Chromium net-error string. The
		// reason is `navigation_failed`.
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError(
				'Chromium net-error page rendered for https://does-not-exist.invalid: ERR_NAME_NOT_RESOLVED',
				'default',
				undefined,
				'navigation_failed',
			),
		);
		// The static-fetch fallback returns the documented
		// `Status: 0 + Error: TypeError: fetch failed` for
		// a DNS-failure URL. We model the static-fetch
		// result shape here.
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'Error: TypeError: fetch failed' }],
			details: {
				url: 'https://does-not-exist.invalid',
				contentType: 'text/html',
				status: 0,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: false,
			},
		});

		const result = await fetchUrl('https://does-not-exist.invalid');

		// The provider error is on the result.
		expect(result.details.providerError).toEqual({
			provider: 'default',
			reason: 'navigation_failed',
			message:
				'[default] Chromium net-error page rendered for https://does-not-exist.invalid: ERR_NAME_NOT_RESOLVED',
		});
		// The static fallback body is in the result.
		expect(result.content[0]?.text).toContain('TypeError: fetch failed');
	});

	it('does NOT cache the fallback result after a navigation failure', async () => {
		managerFetchMock.mockRejectedValueOnce(
			new ProviderError(
				'Chromium net-error page rendered for https://does-not-exist.invalid: ERR_NAME_NOT_RESOLVED',
				'default',
				undefined,
				'navigation_failed',
			),
		);
		staticFetchMock.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'Error: TypeError: fetch failed' }],
			details: {
				url: 'https://does-not-exist.invalid',
				contentType: 'text/html',
				status: 0,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: false,
			},
		});

		await fetchUrl('https://does-not-exist.invalid');

		// A `navigation_failed` reason is transient; the
		// next call must re-attempt the browser. The
		// cache write is rejected, so `setCache` was
		// never called.
		expect(setCacheMock).not.toHaveBeenCalled();
	});

	it('fires `cacheNotify` with a warning that names the URL, provider, and reason', async () => {
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
				status: 0,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: false,
			},
		});

		const cacheNotify = vi.fn();
		await fetchUrl('https://does-not-exist.invalid', fetch, undefined, { cacheNotify });

		// At least one warning is fired, naming the URL,
		// provider, and reason.
		const providerWarning = cacheNotify.mock.calls.find(
			([message]) =>
				typeof message === 'string' &&
				message.includes('default') &&
				message.includes('navigation_failed') &&
				message.includes('does-not-exist.invalid'),
		);
		expect(providerWarning).toBeDefined();
		expect(providerWarning?.[1]).toBe('warn');
	});

	it('a subsequent call within the TTL re-attempts the browser (cache is not poisoned)', async () => {
		// First call: provider fails with `navigation_failed`,
		// static fallback is used, cache is NOT written.
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
				status: 0,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: false,
			},
		});
		await fetchUrl('https://does-not-exist.invalid');

		// Second call: same URL. The cache must NOT have
		// the first call's result (transient errors do not
		// poison the cache). The provider is re-attempted.
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
				status: 0,
				processedAs: 'fallback' as const,
				originalSize: 0,
				tempFileSize: 0,
				truncated: false,
				extracted: false,
			},
		});
		await fetchUrl('https://does-not-exist.invalid');

		// The provider was re-attempted on the second
		// call (the manager's `fetch` was called twice).
		expect(managerFetchMock).toHaveBeenCalledTimes(2);
	});
});
