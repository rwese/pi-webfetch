/**
 * Cache content validation tests
 *
 * Regression for the 2026-06-06 review (finding 1, second half):
 * even with a TTL, a race condition in the browser-tab lifecycle
 * can write a poisoned cache entry. Before persisting, we
 * cross-check the rendered `finalUrl` / `pageTitle` / `<title>`
 * (extracted from `rawContent`) against the requested URL. A
 * mismatch rejects the cache write (with a warning on
 * `details.notify`) but the original `FetchResult` flows through
 * unchanged so the caller can decide whether to retry.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const setCacheMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/cache.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../extensions/cache.js')>();
	return {
		...actual,
		setCache: setCacheMock,
		getCache: async () => null,
		hasCache: async () => false,
		getCacheAge: async () => null,
		clearCache: async () => true,
		clearAllCache: async () => 0,
		getCacheStats: async () => ({ count: 0, totalSize: 0 }),
		formatAge: () => '0 seconds ago',
	};
});

import {
	cacheFetchResult,
	validateCacheEntry,
	extractHtmlTitle,
} from '../extensions/services/cache-service.js';

beforeEach(() => {
	setCacheMock.mockReset();
	setCacheMock.mockResolvedValue(undefined);
});

describe('extractHtmlTitle', () => {
	it('returns the <title> text from a real HTML payload', () => {
		expect(extractHtmlTitle('<html><head><title>Markdown - Wikipedia</title></head></html>')).toBe(
			'Markdown - Wikipedia',
		);
	});

	it('returns undefined for a missing or empty <title>', () => {
		expect(extractHtmlTitle('<html><head></head></html>')).toBeUndefined();
		expect(extractHtmlTitle('<html><head><title>  </title></head></html>')).toBeUndefined();
	});
});

describe('validateCacheEntry', () => {
	it('accepts an entry whose finalUrl matches the requested URL', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				finalUrl: 'https://en.wikipedia.org/wiki/Markdown',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(true);
	});

	it('rejects an entry whose finalUrl is a different host', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				finalUrl: 'https://github.com/foo/bar',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(false);
		expect(out.reason).toMatch(/finalUrl mismatch/);
	});

	it('rejects an entry whose finalUrl is a different path', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(false);
	});

	it('accepts an entry whose pageTitle contains the URL path key', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				pageTitle: 'Markdown - Wikipedia',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(true);
	});

	it('rejects an entry whose pageTitle is for a different page', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				pageTitle: 'Web browser - Wikipedia',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(false);
		expect(out.reason).toMatch(/title mismatch/);
	});

	it('falls back to extracting the title from rawContent', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				rawContent: '<html><head><title>Markdown - Wikipedia</title></head></html>',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(true);
	});

	it('rejects when the title in rawContent does not match the URL', () => {
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				rawContent: '<html><head><title>pi-mono README</title></head></html>',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(false);
		expect(out.reason).toMatch(/title mismatch/);
	});

	it('accepts an entry with no validation signals (binary / raw text)', () => {
		// No `finalUrl`, no `pageTitle`, no `rawContent`. Validation
		// cannot conclude; the entry is accepted.
		const out = validateCacheEntry(
			{ url: 'https://example.com/data.json' },
			'https://example.com/data.json',
		);
		expect(out.valid).toBe(true);
	});

	it('treats finalUrl-mismatch as a stronger signal than title-match', () => {
		// finalUrl differs but title matches. The hard URL signal wins.
		const out = validateCacheEntry(
			{
				url: 'https://en.wikipedia.org/wiki/Markdown',
				finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
				pageTitle: 'Markdown - Wikipedia',
			},
			'https://en.wikipedia.org/wiki/Markdown',
		);
		expect(out.valid).toBe(false);
	});
});

describe('cacheFetchResult — poisoned-cache fixture', () => {
	it('rejects the write when the rendered title belongs to a different page', async () => {
		// The poisoned-cache scenario from review finding 1: a
		// browser-tab race caused the provider to extract HTML for
		// a GitHub README while the caller asked for the Wikipedia
		// "Markdown" article. The cache must NOT persist this.
		const result = {
			content: [
				{
					type: 'text' as const,
					text: 'pi-mono README content',
				},
			],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
				finalUrl: 'https://github.com/earendil-works/pi',
				pageTitle: 'pi-mono README',
			},
		};
		const out = await cacheFetchResult(result);
		expect(setCacheMock).not.toHaveBeenCalled();
		expect(out.details.notify).toContain('cache write rejected');
		// Original result flows through unchanged.
		expect(out.content[0]?.text).toBe('pi-mono README content');
	});

	it('rejects the write when rawContent title does not match the URL', async () => {
		const result = {
			content: [{ type: 'text' as const, text: 'body' }],
			details: {
				url: 'https://en.wikipedia.org/wiki/Markdown',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
				rawContent: '<html><head><title>pi-mono README</title></head></html>',
			},
		};
		await cacheFetchResult(result);
		expect(setCacheMock).not.toHaveBeenCalled();
	});

	it('persists a correct, non-poisoned entry', async () => {
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
});
