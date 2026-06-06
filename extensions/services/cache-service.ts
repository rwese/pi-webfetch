/**
 * Cache Service
 *
 * Handles caching logic for fetch results.
 */

import type { FetchResult, WebfetchDetails } from '../types.js';
import { getCache, setCache, formatAge, type CacheKeyOptions } from '../cache.js';

/**
 * Check if we should skip caching for a URL
 * Currently skips raw GitHub URLs as they are typically versioned content
 */
export function shouldSkipCache(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname.toLowerCase() === 'raw.githubusercontent.com';
	} catch {
		return false;
	}
}

/**
 * Build cache metadata from fetch result
 */
export function buildCacheEntry(result: FetchResult): {
	url: string;
	content: string;
	contentType: string | null;
	status: number;
	provider: string | undefined;
	extractionMethod: string | undefined;
	cachedAt: number;
	// Persist the raw payload alongside the processed content so a
	// research subagent that hits the cache still has the original
	// HTML / text available to write to `input_raw.<ext>`. These
	// mirror `WebfetchDetails.rawContent` / `rawContentType`; we
	// pass them through verbatim when the provider exposed them.
	rawContent?: string;
	rawContentType?: string | null;
} | null {
	const url = result.details.url;
	const textContent = result.content[0]?.text;
	if (!textContent) return null;

	return {
		url,
		content: textContent,
		contentType: result.details.contentType,
		status: result.details.status,
		provider: result.details.provider,
		extractionMethod: result.details.extractionMethod,
		cachedAt: Date.now(),
		...(result.details.rawContent !== undefined
			? { rawContent: result.details.rawContent }
			: {}),
		...(result.details.rawContentType !== undefined
			? { rawContentType: result.details.rawContentType }
			: {}),
	};
}

/**
 * Cache a successful fetch result
 */
export async function cacheFetchResult(
	result: FetchResult,
	options?: CacheKeyOptions,
): Promise<FetchResult> {
	const url = result.details.url;
	if (shouldSkipCache(url)) return result;

	const entry = buildCacheEntry(result);
	if (!entry) return result;

	try {
		await setCache(url, entry, options);
	} catch {
		// Cache write failure is non-fatal
	}

	return result;
}

/**
 * Get cached result if available
 */
export async function getCachedResult(
	url: string,
	options?: CacheKeyOptions,
): Promise<FetchResult | null> {
	if (shouldSkipCache(url)) return null;

	const cached = await getCache(url, options);
	if (!cached) return null;

	const cacheAge = Date.now() - cached.cachedAt;
	const details: WebfetchDetails = {
		url,
		contentType: cached.contentType,
		status: cached.status,
		processedAs: 'fallback',
		provider: cached.provider,
		extractionMethod: cached.extractionMethod,
		cached: true,
		cacheAge,
		// Forward the persisted raw payload (if any) so the research
		// service can still write `input_raw.<ext>` when the fetch
		// was served from cache.
		...(cached.rawContent !== undefined ? { rawContent: cached.rawContent } : {}),
		...(cached.rawContentType !== undefined
			? { rawContentType: cached.rawContentType }
			: {}),
	};

	// Append cache footer to content
	const cacheFooter = `\n\n---\n\n> 💾 *Cached result from ${formatAge(cacheAge)}*`;

	return {
		content: [{ type: 'text' as const, text: cached.content + cacheFooter }],
		details,
	};
}
