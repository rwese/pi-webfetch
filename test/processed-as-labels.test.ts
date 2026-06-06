/**
 * Processed-as labels tests
 *
 * Regression for review finding 10 (BXAJ / M3): the
 * `Processed as: ...` header always read `spa` even when the
 * fetch was a static fallback or a cache hit, which confused
 * the user (a `spa` label on a non-SPA page implies a real
 * browser ran, which it did not). The v0.9.0 fix widens the
 * `processedAs` enum and maps each value to a clear
 * user-facing label.
 *
 * These tests pin the label table and the source mapping
 * (which fetch path emits which value).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

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
	staticFetch: async () => ({
		content: [{ type: 'text' as const, text: 'body' }],
		details: {
			url: 'https://example.com',
			contentType: 'text/html',
			status: 200,
			processedAs: 'static' as const,
		},
	}),
	handleBinary: async () => ({
		content: [{ type: 'text' as const, text: 'binary' }],
		details: {
			url: 'https://example.com',
			contentType: 'application/octet-stream',
			status: 200,
			processedAs: 'binary' as const,
		},
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
	formatAge: () => '0 seconds ago',
	isFresh: () => true,
	parseDurationToMs: (v: string) => Number(v) || null,
	DEFAULT_CACHE_TTL_MS: 3_600_000,
}));

import { fetchUrl } from '../extensions/services/fetch-service.js';
import { buildFetchHeader } from '../extensions/services/header-builder.js';
import { getCachedResult } from '../extensions/services/cache-service.js';

beforeEach(() => {
	getCacheMock.mockReset();
	setCacheMock.mockReset();
	getCacheMock.mockResolvedValue(null);
	setCacheMock.mockResolvedValue(undefined);
});

describe('buildFetchHeader — Processed as label', () => {
	function headerForProcessedAs(processedAs: string): string {
		return buildFetchHeader({
			url: 'https://example.com',
			contentType: 'text/html',
			status: 200,
			processedAs: processedAs as never,
		});
	}

	it('labels `spa` (real-browser, networkidle wait) as `spa`', () => {
		expect(headerForProcessedAs('spa')).toContain('**Processed as:** spa');
	});

	it('labels `html` (real-browser, domcontentloaded wait) as `html`', () => {
		expect(headerForProcessedAs('html')).toContain('**Processed as:** html');
	});

	it('labels `static` (HTTP-only fetch) as `static`', () => {
		expect(headerForProcessedAs('static')).toContain('**Processed as:** static');
	});

	it('labels `fallback` (graceful-degradation path) as `fallback`', () => {
		expect(headerForProcessedAs('fallback')).toContain('**Processed as:** fallback');
	});

	it('labels `binary` (file download) as `binary`', () => {
		expect(headerForProcessedAs('binary')).toContain('**Processed as:** binary');
	});

	it('labels `cache` (cache hit) as `cache`', () => {
		expect(headerForProcessedAs('cache')).toContain('**Processed as:** cache');
	});

	it('falls back to `unknown` when processedAs is missing', () => {
		const header = buildFetchHeader({
			url: 'https://example.com',
			contentType: null,
			status: 0,
			processedAs: '' as never,
		});
		expect(header).toContain('**Processed as:** unknown');
	});
});

describe('processedAs source mapping', () => {
	it('cache hit emits `processedAs: "cache"` (M3.C rename from `fallback`)', async () => {
		getCacheMock.mockResolvedValueOnce({
			url: 'https://example.com',
			content: 'cached body',
			contentType: 'text/html',
			status: 200,
			cachedAt: Date.now() - 1_000,
		});
		const result = await getCachedResult('https://example.com');
		expect(result?.details.processedAs).toBe('cache');
	});

	it('static fetch (provider fetch returned null) emits `processedAs: "static"`', async () => {
		const result = await fetchUrl('https://example.com');
		expect(result.details.processedAs).toBe('static');
	});
});
