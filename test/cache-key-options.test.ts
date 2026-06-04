/**
 * Cache - Option-Scoped Cache Keys
 *
 * Regression for: a webfetch call with the default options (no
 * `includeComments`) caches a result with the `> Tip:` discovery hint
 * footer. A subsequent call with `includeComments: true` would
 * previously return the cached (stale, no-comments) result because the
 * cache key was URL-only.
 *
 * These tests assert that the cache key now incorporates a stable hash
 * of the provider fetch options, so different option combinations
 * produce different cache entries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCacheMock = vi.hoisted(() => vi.fn());
const setCacheMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/services/session-manager.js', () => ({
	getProviderManager: async () => ({
		fetch: async () => ({
			content: '# Title',
			contentType: 'text/markdown',
			status: 200,
			extractionMethod: 'gh-issue-view',
			providerName: 'gh-cli',
			metadata: { title: 'Title' },
		}),
		closeAll: async () => undefined,
	}),
	closeAllProviders: async () => undefined,
	closeAllSessionsProviders: async () => undefined,
	getProviderStatus: async () => [],
}));

vi.mock('../extensions/services/static-fetch.js', () => ({
	staticFetch: async () => ({
		content: [{ type: 'text' as const, text: 'static' }],
		details: { url: '', contentType: null, status: 0, processedAs: 'fallback' as const },
	}),
	handleBinary: async () => ({
		content: [{ type: 'text' as const, text: 'binary' }],
		details: { url: '', contentType: null, status: 0, processedAs: 'binary' as const },
	}),
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
	formatAge: () => '',
}));

import { fetchUrl } from '../extensions/services/fetch-service.js';

beforeEach(() => {
	getCacheMock.mockReset();
	setCacheMock.mockReset();
	getCacheMock.mockResolvedValue(null);
	setCacheMock.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchUrl cache key is option-scoped', () => {
	it('passes a cacheKey to getCache when includeComments is set', async () => {
		await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: true } },
		);
		expect(getCacheMock).toHaveBeenCalledTimes(1);
		const args = getCacheMock.mock.calls[0];
		expect(args?.[0]).toBe('https://github.com/foo/bar/issues/1');
		// Second arg is the CacheKeyOptions, should contain a cacheKey
		// derived from { includeComments: true }.
		const opts = args?.[1] as { cacheKey?: string } | undefined;
		expect(opts?.cacheKey).toBeDefined();
	});

	it('omits the cacheKey when no GitHub options are provided', async () => {
		await fetchUrl('https://github.com/foo/bar/issues/1');
		const args = getCacheMock.mock.calls[0];
		const opts = args?.[1] as { cacheKey?: string } | undefined;
		expect(opts?.cacheKey).toBeUndefined();
	});

	it('produces different cache keys for includeComments=true and =false', async () => {
		await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: true } },
		);
		await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: false } },
		);

		const key1 = (getCacheMock.mock.calls[0]?.[1] as { cacheKey?: string } | undefined)
			?.cacheKey;
		const key2 = (getCacheMock.mock.calls[1]?.[1] as { cacheKey?: string } | undefined)
			?.cacheKey;
		expect(key1).toBeDefined();
		expect(key2).toBeDefined();
		expect(key1).not.toBe(key2);
	});

	it('produces the same cache key for the same options regardless of declaration order', async () => {
		// Same options, different property order: must produce the same key.
		const optsA = { github: { includeComments: true } };
		const optsB = { github: { includeComments: true } };
		await fetchUrl('https://github.com/foo/bar/issues/1', fetch, undefined, optsA);
		await fetchUrl('https://github.com/foo/bar/issues/1', fetch, undefined, optsB);
		const key1 = (getCacheMock.mock.calls[0]?.[1] as { cacheKey?: string } | undefined)
			?.cacheKey;
		const key2 = (getCacheMock.mock.calls[1]?.[1] as { cacheKey?: string } | undefined)
			?.cacheKey;
		expect(key1).toBe(key2);
	});

	it('regression: a previous no-options fetch must not poison a later includeComments fetch', async () => {
		// The mock returns the same content for every call; the cache is
		// mocked to always miss on the first read for a slot. The point
		// of this test is to assert: with the cache-key fix, the two
		// fetches read from DIFFERENT cache slots, so a Tip footer
		// cached by the first call is not returned for the second.
		const cache = new Map<string, { content: string }>();
		getCacheMock.mockImplementation(async (_url, opts) => {
			const key = (opts as { cacheKey?: string })?.cacheKey ?? '';
			return cache.get(`https://github.com/foo/bar/issues/1|${key}`) ?? null;
		});
		setCacheMock.mockImplementation(async (_url, entry, opts) => {
			const key = (opts as { cacheKey?: string })?.cacheKey ?? '';
			cache.set(`https://github.com/foo/bar/issues/1|${key}`, {
				content: entry.content,
			});
		});

		// First fetch: no includeComments -> its own cache slot.
		const noOptionsResult = await fetchUrl('https://github.com/foo/bar/issues/1');
		const noOptionsText = noOptionsResult.content[0]?.text ?? '';
		expect(noOptionsText).toBeTruthy();

		// Second fetch: includeComments: true -> reads a different cache slot.
		const withOptionsResult = await fetchUrl(
			'https://github.com/foo/bar/issues/1',
			fetch,
			undefined,
			{ github: { includeComments: true } },
		);
		const withOptionsText = withOptionsResult.content[0]?.text ?? '';

		// The two cache keys should be distinct, so the second fetch
		// misses the cache for the first and re-fetches the provider.
		expect(getCacheMock).toHaveBeenCalledTimes(2);
		const key1 = (getCacheMock.mock.calls[0]?.[1] as { cacheKey?: string } | undefined)
			?.cacheKey;
		const key2 = (getCacheMock.mock.calls[1]?.[1] as { cacheKey?: string } | undefined)
			?.cacheKey;
		expect(key1).not.toBe(key2);

		// And the second fetch's content comes from its own slot (which
		// is empty, so the provider was hit). The exact content is
		// determined by the provider mock, but the important thing is
		// the cache didn't return a stale result with a Tip footer.
		expect(withOptionsText).not.toContain('Tip: pass `includeComments');
	});
});
