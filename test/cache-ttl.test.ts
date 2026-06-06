/**
 * Cache TTL tests
 *
 * Regression for the 2026-06-06 review (finding 1): the cache used
 * to be TTL-less, so a "1 day ago" entry could permanently haunt
 * the current session. The fix is `isFresh(entry, now, ttlMs)` and
 * `DEFAULT_CACHE_TTL_MS = 1h` threaded through `getCachedResult` /
 * `cacheFetchResult`. These tests pin the three cases: fresh,
 * stale, and a user-overridden TTL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'pi-webfetch-cache-ttl-'));
vi.mock('../extensions/cache.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../extensions/cache.js')>();
	return {
		...actual,
		// Use a private cache dir per test run so we never read the
		// user's real `<tmpdir>/pi-webfetch-cache/` directory. We
		// override only the `CACHE_DIR` constant via the module's
		// own `join` by redirecting `tmpdir` is too invasive; instead
		// we let the real module write to the real dir for the
		// duration of these tests and clean up in `afterEach`.
		...{},
	};
});

const getCacheMock = vi.hoisted(() => vi.fn());
const setCacheMock = vi.hoisted(() => vi.fn());
const clearAllCacheMock = vi.hoisted(() => vi.fn());
const clearCacheOlderThanMock = vi.hoisted(() => vi.fn());

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

vi.mock('../extensions/cache.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../extensions/cache.js')>();
	return {
		...actual,
		getCache: getCacheMock,
		setCache: setCacheMock,
		hasCache: async () => false,
		getCacheAge: async () => null,
		clearCache: async () => true,
		clearCacheOlderThan: clearCacheOlderThanMock,
		clearAllCache: clearAllCacheMock,
		getCacheStats: async () => ({ count: 0, totalSize: 0 }),
		formatAge: () => '0 seconds ago',
	};
});

import {
	getCachedResult,
	cacheFetchResult,
} from '../extensions/services/cache-service.js';
import { fetchUrl } from '../extensions/services/fetch-service.js';
import {
	DEFAULT_CACHE_TTL_MS,
	isFresh,
	parseDurationToMs,
} from '../extensions/cache.js';

beforeEach(() => {
	getCacheMock.mockReset();
	setCacheMock.mockReset();
	clearAllCacheMock.mockReset();
	clearCacheOlderThanMock.mockReset();
	getCacheMock.mockResolvedValue(null);
	setCacheMock.mockResolvedValue(undefined);
	clearAllCacheMock.mockResolvedValue(0);
	clearCacheOlderThanMock.mockResolvedValue(false);
});

afterEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	// Best-effort cleanup of the real cache dir for the URLs used
	// in these tests. We do not assert on it.
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe('isFresh', () => {
	it('treats an entry written at the same instant as fresh', () => {
		const now = 1_000_000;
		expect(isFresh({ cachedAt: now }, now, 1000)).toBe(true);
	});

	it('treats an entry older than the TTL as stale', () => {
		const now = 1_000_000;
		expect(isFresh({ cachedAt: now - 2000 }, now, 1000)).toBe(false);
	});

	it('respects a user-overridden TTL', () => {
		const now = 1_000_000;
		// Entry is 500ms old; default 1h would say fresh, but the
		// user wants 100ms.
		expect(isFresh({ cachedAt: now - 500 }, now, 100)).toBe(false);
		expect(isFresh({ cachedAt: now - 500 }, now, 10_000)).toBe(true);
	});

	it('falls back to the default 1h TTL when none is provided', () => {
		const now = 1_000_000;
		expect(DEFAULT_CACHE_TTL_MS).toBe(60 * 60 * 1000);
		expect(isFresh({ cachedAt: now - 30 * 60 * 1000 }, now)).toBe(true);
		expect(isFresh({ cachedAt: now - 2 * 60 * 60 * 1000 }, now)).toBe(false);
	});

	it('rejects non-positive TTLs (defends against the poisoned-cache case)', () => {
		const now = 1_000_000;
		expect(isFresh({ cachedAt: now }, now, 0)).toBe(false);
		expect(isFresh({ cachedAt: now }, now, -1)).toBe(false);
	});
});

describe('parseDurationToMs', () => {
	it('parses bare integers as milliseconds', () => {
		expect(parseDurationToMs('0')).toBe(0);
		expect(parseDurationToMs('1500')).toBe(1500);
	});

	it('parses common unit suffixes', () => {
		expect(parseDurationToMs('500ms')).toBe(500);
		expect(parseDurationToMs('2s')).toBe(2_000);
		expect(parseDurationToMs('30m')).toBe(30 * 60 * 1000);
		expect(parseDurationToMs('2h')).toBe(2 * 60 * 60 * 1000);
		expect(parseDurationToMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
	});

	it('returns null for malformed input', () => {
		expect(parseDurationToMs('')).toBeNull();
		expect(parseDurationToMs('abc')).toBeNull();
		expect(parseDurationToMs('5x')).toBeNull();
		expect(parseDurationToMs('-1h')).toBeNull();
	});
});

describe('getCachedResult TTL', () => {
	it('returns a fresh entry as a cache hit (within default TTL)', async () => {
		const now = Date.now();
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'body',
			contentType: 'text/html',
			status: 200,
			cachedAt: now - 5_000, // 5s old
		});

		const result = await getCachedResult('https://example.com');
		expect(result).not.toBeNull();
		expect(result?.details.cached).toBe(true);
		// cacheAge is `Date.now() - cachedAt` so a tiny bit of
		// time may have passed between the two `Date.now()`
		// calls. Allow up to 1 second of slack so the test
		// is not flaky on slow CI.
		expect(result?.details.cacheAge).toBeGreaterThanOrEqual(5_000);
		expect(result?.details.cacheAge).toBeLessThan(6_000);
	});

	it('treats a stale entry (older than the TTL) as a miss', async () => {
		const now = Date.now();
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'body',
			contentType: 'text/html',
			status: 200,
			cachedAt: now - 2 * 60 * 60 * 1000, // 2h old
		});

		const result = await getCachedResult('https://example.com');
		expect(result).toBeNull();
	});

	it('honours a user-overridden TTL on read', async () => {
		const now = Date.now();
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'body',
			contentType: 'text/html',
			status: 200,
			cachedAt: now - 30_000, // 30s old
		});

		// With a 10s TTL the 30s entry is stale and treated as a miss.
		expect(await getCachedResult('https://example.com', { cacheTtlMs: 10_000 })).toBeNull();

		// With a 60s TTL the same entry is fresh.
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'body',
			contentType: 'text/html',
			status: 200,
			cachedAt: now - 30_000,
		});
		const hit = await getCachedResult('https://example.com', { cacheTtlMs: 60_000 });
		expect(hit).not.toBeNull();
	});

	it('respects a clock injection so tests can assert fresh/stale', async () => {
		const cachedAt = 1_000_000;
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'body',
			contentType: 'text/html',
			status: 200,
			cachedAt,
		});

		// 5 minutes later, default TTL (1h) -> fresh.
		expect(
			await getCachedResult('https://example.com', { now: () => cachedAt + 5 * 60 * 1000 }),
		).not.toBeNull();

		// 5 minutes later, 1-minute TTL -> stale.
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'body',
			contentType: 'text/html',
			status: 200,
			cachedAt,
		});
		expect(
			await getCachedResult('https://example.com', {
				now: () => cachedAt + 5 * 60 * 1000,
				cacheTtlMs: 60_000,
			}),
		).toBeNull();
	});
});

describe('fetchUrl forwards cacheTtlMs to the cache layer', () => {
	it('passes a user-supplied cacheTtlMs to getCachedResult', async () => {
		await fetchUrl('https://example.com', fetch, undefined, { cacheTtlMs: 5_000 });
		expect(getCacheMock).toHaveBeenCalledTimes(1);
		const opts = getCacheMock.mock.calls[0]?.[1] as { cacheTtlMs?: number } | undefined;
		expect(opts?.cacheTtlMs).toBe(5_000);
	});

	it('omits cacheTtlMs when not provided', async () => {
		await fetchUrl('https://example.com');
		const opts = getCacheMock.mock.calls[0]?.[1] as { cacheTtlMs?: number } | undefined;
		expect(opts?.cacheTtlMs).toBeUndefined();
	});
});

describe('cacheFetchResult', () => {
	it('skips the cache write when validateCacheEntry rejects the content', async () => {
		const result = {
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
				finalUrl: 'https://github.com/foo/bar', // poisoned: wrong URL
				pageTitle: 'pi-mono README',
			},
		};
		const out = await cacheFetchResult(result);
		expect(setCacheMock).not.toHaveBeenCalled();
		// Warn-and-skip-persist: the result flows through unchanged
		// but with a `notify` warning attached.
		expect(out.details.notify).toContain('cache write rejected');
	});

	it('persists the entry when content validation passes', async () => {
		const result = {
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
				finalUrl: 'https://en.wikipedia.org/wiki/Markdown',
				pageTitle: 'Markdown - Wikipedia',
			},
		};
		await cacheFetchResult(result);
		expect(setCacheMock).toHaveBeenCalledTimes(1);
	});

	it('persists the entry when no validation signals are available (binary / raw)', async () => {
		const result = {
			content: [{ type: 'text' as const, text: '# Title' }],
			details: {
				url: 'https://example.com/data.json',
				contentType: 'application/json',
				status: 200,
				processedAs: 'binary' as const,
				// No `finalUrl` / `pageTitle` / `rawContent` — common
				// for raw text / binary paths. Validation cannot
				// conclude, so we accept the entry.
			},
		};
		await cacheFetchResult(result);
		expect(setCacheMock).toHaveBeenCalledTimes(1);
	});

	it('fires the notify channel on a validation mismatch', async () => {
		const result = {
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
				finalUrl: 'https://example.com/wrong',
			},
		};
		const messages: Array<{ message: string; level: string }> = [];
		await cacheFetchResult(result, undefined, (message, level) => {
			messages.push({ message, level });
		});
		expect(messages).toHaveLength(1);
		expect(messages[0]?.level).toBe('warn');
		expect(messages[0]?.message).toContain('cache write rejected');
	});
});
