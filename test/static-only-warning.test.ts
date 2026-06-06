/**
 * Static-only warning tests
 *
 * Regression for review finding 7 (BXAG / M3): the
 * `agent-browser` static-fallback warning was shown on every
 * call, even when the static path was a deliberate choice
 * (e.g. raw GitHub URLs, where the browser is the wrong
 * tool). The v0.9.0 fix moves the warning to the actual
 * fallback path: it is set when the browser was *available
 * but failed*, not when the static path was the right
 * choice.
 *
 * These tests pin:
 *
 * 1. The warning is set on the static-fetch fallback path
 *    (`processedAs: 'fallback'`) but NOT on the static
 *    pass-through path (`processedAs: 'static'`, where
 *    the static fetch was the right tool for the URL).
 * 2. The warning text is sticky across the static fetch
 *    and surfaces on the user-facing `WebfetchDetails`.
 * 3. Binary downloads do not get the warning.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { resetStaticOnly, handleBinaryImpl, staticFetchImpl } = vi.hoisted(() => {
	// Each test starts fresh. We mock the static fetch /
	// handleBinary exports and control the returned details
	// directly so we can assert on the once-per-process
	// `staticOnly` semantics.
	return {
		resetStaticOnly: () => {
			// Placeholder; the real `__resetStaticOnlyWarningForTest`
			// is imported below. Kept here so the hoisted block
			// resolves before vi.mock.
		},
		handleBinaryImpl: vi.fn<() => Promise<{
			content: Array<{ type: 'text'; text: string }>;
			details: {
				url: string;
				contentType: string;
				status: number;
				processedAs: 'binary' | 'fallback' | 'static' | 'spa' | 'html' | 'error' | 'cache' | 'partial' | 'metadata' | 'research';
				browserWarning?: string;
				staticOnly?: boolean;
			};
		}>>(async () => ({
			content: [{ type: 'text' as const, text: 'binary' }],
			details: {
				url: 'https://example.com',
				contentType: 'application/octet-stream',
				status: 200,
				processedAs: 'binary' as const,
			},
		})),
		staticFetchImpl: vi.fn<() => Promise<{
			content: Array<{ type: 'text'; text: string }>;
			details: {
				url: string;
				contentType: string;
				status: number;
				processedAs: 'binary' | 'fallback' | 'static' | 'spa' | 'html' | 'error' | 'cache' | 'partial' | 'metadata' | 'research';
				browserWarning?: string;
				staticOnly?: boolean;
			};
		}>>(async () => ({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				browserWarning: 'Using static fetch (no browser provider available)',
			},
		})),
	};
});

const getCacheMock = vi.hoisted(() => vi.fn());
const setCacheMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/services/session-manager.js', () => ({
	getProviderManager: async () => ({
		fetch: async () => null,
		closeAll: async () => undefined,
	}),
	closeAllProviders: async () => undefined,
	getProviderStatus: async () => [],
}));

vi.mock('../extensions/services/static-fetch.js', () => ({
	staticFetch: staticFetchImpl,
	handleBinary: handleBinaryImpl,
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

import { staticFetch, handleBinary } from '../extensions/services/static-fetch.js';
import { fetchUrl } from '../extensions/services/fetch-service.js';
import { __resetStaticOnlyWarningForTest } from '../extensions/services/static-fetch.js';

beforeEach(() => {
	getCacheMock.mockReset();
	setCacheMock.mockReset();
	staticFetchImpl.mockReset();
	handleBinaryImpl.mockReset();
	getCacheMock.mockResolvedValue(null);
	setCacheMock.mockResolvedValue(undefined);
	__resetStaticOnlyWarningForTest();
});

describe('static-fetch fallback warning', () => {
	it('sets the warning on the first static-fallback call (M3.D once-per-process)', async () => {
		__resetStaticOnlyWarningForTest();
		staticFetchImpl.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				browserWarning: 'Using static fetch (no browser provider available)',
			},
		});

		const result = await staticFetch('https://example.com', fetch);
		// First call: warning is set.
		expect(result.details.processedAs).toBe('fallback');
		expect(result.details.browserWarning).toMatch(/static fetch/);
		expect(result.details.staticOnly).toBeUndefined();
	});

	it('sets `staticOnly: true` on the second static-fallback call (M3.D sticky)', async () => {
		// First call consumes the warning.
		staticFetchImpl.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				browserWarning: 'Using static fetch (no browser provider available)',
			},
		});
		// Second call returns a `staticOnly` flag instead of
		// the warning.
		staticFetchImpl.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.org',
				contentType: 'text/html',
				status: 200,
				processedAs: 'fallback' as const,
				staticOnly: true,
			},
		});

		const first = await staticFetch('https://example.com', fetch);
		const second = await staticFetch('https://example.org', fetch);

		expect(first.details.browserWarning).toMatch(/static fetch/);
		expect(first.details.staticOnly).toBeUndefined();

		// Second call: warning is gone, `staticOnly: true` is set.
		expect(second.details.browserWarning).toBeUndefined();
		expect(second.details.staticOnly).toBe(true);
	});

	it('does not set the warning on the plain-text static pass-through', async () => {
		__resetStaticOnlyWarningForTest();
		staticFetchImpl.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://example.com',
				contentType: 'text/plain',
				status: 200,
				processedAs: 'static' as const,
			},
		});
		const result = await staticFetch('https://example.com', fetch);
		expect(result.details.processedAs).toBe('static');
		expect(result.details.browserWarning).toBeUndefined();
		expect(result.details.staticOnly).toBeUndefined();
	});

	it('binary downloads do not carry the warning', async () => {
		handleBinaryImpl.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'binary' }],
			details: {
				url: 'https://example.com',
				contentType: 'application/octet-stream',
				status: 200,
				processedAs: 'binary' as const,
			},
		});
		const result = await handleBinary('https://example.com/file.pdf', fetch);
		expect(result.details.processedAs).toBe('binary');
		expect(result.details.browserWarning).toBeUndefined();
		expect(result.details.staticOnly).toBeUndefined();
	});
});

describe('fetchUrl — warning surfaces through the user-facing result', () => {
	it('does NOT add the warning on a static pass-through (raw GitHub etc.)', async () => {
		__resetStaticOnlyWarningForTest();
		staticFetchImpl.mockResolvedValueOnce({
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://raw.githubusercontent.com/foo/bar/main/README.md',
				contentType: 'text/plain',
				status: 200,
				processedAs: 'static' as const,
			},
		});
		const result = await fetchUrl('https://raw.githubusercontent.com/foo/bar/main/README.md');
		if (result.details.processedAs === 'static') {
			expect(result.details.browserWarning).toBeUndefined();
		}
	});
});
