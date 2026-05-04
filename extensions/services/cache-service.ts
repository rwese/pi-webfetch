/**
 * Cache Service
 * 
 * Handles caching logic for fetch results.
 */

import type { FetchResult, WebfetchDetails } from '../types.js';
import { getCache, setCache, formatAge } from '../cache.js';

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
	};
}

/**
 * Cache a successful fetch result
 */
export async function cacheFetchResult(result: FetchResult): Promise<FetchResult> {
	const url = result.details.url;
	if (shouldSkipCache(url)) return result;

	const entry = buildCacheEntry(result);
	if (!entry) return result;

	try {
		await setCache(url, entry);
	} catch {
		// Cache write failure is non-fatal
	}

	return result;
}

/**
 * Get cached result if available
 */
export async function getCachedResult(url: string): Promise<FetchResult | null> {
	if (shouldSkipCache(url)) return null;

	const cached = await getCache(url);
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
	};

	// Append cache footer to content
	const cacheFooter = `\n\n---\n\n> 💾 *Cached result from ${formatAge(cacheAge)}*`;

	return {
		content: [{ type: 'text' as const, text: cached.content + cacheFooter }],
		details,
	};
}
