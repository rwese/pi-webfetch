/**
 * Cache Service
 *
 * Handles caching logic for fetch results.
 */

import { load } from 'cheerio';
import type { FetchResult, WebfetchDetails } from '../types.js';
import {
	getCache,
	setCache,
	formatAge,
	isFresh,
	type CacheEntry,
	type CacheKeyOptions,
} from '../cache.js';

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
 * Pull the page `<title>` out of a raw HTML payload. Returns
 * `undefined` when the HTML has no `<title>`, when the title is
 * empty, or when `cheerio` fails to parse it. Used by
 * `validateCacheEntry` to confirm that a cached entry actually
 * corresponds to the requested URL.
 */
export function extractHtmlTitle(html: string): string | undefined {
	try {
		const $ = load(html);
		const title = $('title').first().text().trim();
		return title || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Pick a normalised comparison key from a URL's path. The last
 * path segment is preferred (matches the page name in
 * Wikipedia-style `/wiki/<name>` URLs); when the path has no
 * segments, the full path is used. The result is lowercased and
 * separators are collapsed to a single `-`. Used by
 * `validateCacheEntry` to confirm the cached `<title>` matches
 * the requested URL when the provider did not surface a
 * `finalUrl`.
 */
/**
 * Classify a `ProviderErrorReason` as transient. Transient
 * reasons do not poison the cache: a subsequent call within
 * the same TTL re-attempts the provider. Deterministic
 * reasons (e.g. `low_text_ratio`) are safe to cache because
 * they describe a static property of the rendered page.
 */
function isTransientProviderErrorReason(
	reason: 'unknown' | 'timeout' | 'navigation_failed' | 'low_text_ratio',
): boolean {
	return reason === 'timeout' || reason === 'navigation_failed';
}

function pathToComparisonKey(url: string): string {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split('/').filter(Boolean);
		const candidate = segments.length > 0 ? segments[segments.length - 1] : parsed.pathname;
		return candidate
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	} catch {
		return '';
	}
}

/**
 * Compare the rendered `<title>` against a fuzzy URL-derived
 * expectation. The check is intentionally loose: it accepts
 * titles whose `comparison key` substring appears anywhere in
 * the title, in either direction. The intent is to catch the
 * poisoned-cache case (a different page was rendered into the
 * browser tab) without rejecting legitimate content like a
 * Wikipedia article whose title ends with the URL path's last
 * segment plus a `- Wikipedia` suffix.
 */
function titleMatchesUrl(title: string | undefined, requestedUrl: string): boolean {
	if (!title) return false;
	const titleKey = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!titleKey) return false;
	const urlKey = pathToComparisonKey(requestedUrl);
	if (!urlKey) return false;
	// Either side contains the other. Catches the common cases
	// (e.g. URL path `markdown` matches title `Markdown` or
	// `Markdown - Wikipedia`) without false positives on very
	// generic titles.
	if (urlKey.length < 4) {
		// Avoid matching very short URL keys against any short
		// word in the title (e.g. URL `/api` matching title `API`).
		return titleKey === urlKey;
	}
	return titleKey.includes(urlKey) || urlKey.includes(titleKey);
}

/**
 * Validate a cache entry against the requested URL. Returns
 * `true` when the entry is safe to persist (or when the entry
 * has no validation signals at all — e.g. binary downloads
 * where the provider does not surface `<title>` or `finalUrl`).
 * Returns `false` on a likely mismatch.
 *
 * The check is a "warn and skip persist", never a re-throw. The
 * original `FetchResult` flows through to the caller unchanged;
 * the cache write is just skipped. This is the second half of
 * the review's M1 fix for finding 1 (cache poisoning).
 */
export function validateCacheEntry(
	entry: Pick<CacheEntry, 'finalUrl' | 'pageTitle' | 'rawContent' | 'url'>,
	requestedUrl: string,
): { valid: boolean; reason?: string } {
	// Best signal: the provider surfaced the final URL. When set,
	// the requested URL must match (same host + path), allow for
	// trailing-slash normalisation.
	if (entry.finalUrl) {
		try {
			const a = new URL(entry.finalUrl);
			const b = new URL(requestedUrl);
			const sameHost = a.hostname.toLowerCase() === b.hostname.toLowerCase();
			const aPath = a.pathname.replace(/\/+$/, '') || '/';
			const bPath = b.pathname.replace(/\/+$/, '') || '/';
			if (!sameHost || aPath !== bPath) {
				return {
					valid: false,
					reason: `finalUrl mismatch (got ${entry.finalUrl}, requested ${requestedUrl})`,
				};
			}
		} catch {
			return { valid: false, reason: 'finalUrl is not a valid URL' };
		}
	}

	// Secondary signal: the rendered `<title>` contains (or is
	// contained by) the URL's path key. When neither signal is
	// available (e.g. plain text / markdown content), accept the
	// entry — there is no title to mismatch.
	if (entry.pageTitle) {
		if (!titleMatchesUrl(entry.pageTitle, requestedUrl)) {
			return {
				valid: false,
				reason: `title mismatch (rendered title "${entry.pageTitle}" does not match URL ${requestedUrl})`,
			};
		}
	} else if (!entry.finalUrl && entry.rawContent) {
		// Fall back to extracting a title from the raw payload.
		const extracted = extractHtmlTitle(entry.rawContent);
		if (extracted && !titleMatchesUrl(extracted, requestedUrl)) {
			return {
				valid: false,
				reason: `title mismatch (extracted title "${extracted}" does not match URL ${requestedUrl})`,
			};
		}
	}

	return { valid: true };
}

/**
 * Per-call cache TTL override (ms). `undefined` falls back to
 * `DEFAULT_CACHE_TTL_MS` (1 hour). Used by `fetchUrl`,
 * `webfetchSPA`, `cacheFetchResult`, and `getCachedResult` to
 * thread the `--cache-ttl <ms>` / `cacheTtlMs` flag down from
 * the CLI / MCP / extension / pi-tool surfaces.
 */
export interface CacheFetchOptions extends CacheKeyOptions {
	/** Per-call TTL override. Falls back to `DEFAULT_CACHE_TTL_MS`. */
	cacheTtlMs?: number;
	/**
	 * Per-call clock injection. Defaults to `() => Date.now()`.
	 * Used by the cache TTL test to assert staleness without
	 * mutating `Date.now()`.
	 */
	now?: () => number;
}

/**
 * Build cache metadata from fetch result
 */
export function buildCacheEntry(result: FetchResult): {
	url: string;
	content: string;
	contentType: string | null;
	status: number;
	finalUrl?: string;
	pageTitle?: string;
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
		...(result.details.finalUrl !== undefined ? { finalUrl: result.details.finalUrl } : {}),
		...(result.details.pageTitle !== undefined ? { pageTitle: result.details.pageTitle } : {}),
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
 * Cache a successful fetch result. With `options.cacheTtlMs` set
 * the persisted entry's `cachedAt` is back-dated so a fresh entry
 * looks fresh, and a stale entry (older than the TTL) is
 * overwritten by the new write — the TTL is checked on read, not
 * on write. `options.now()` is honored for tests; production
 * callers never pass it.
 *
 * The second half of finding 1's fix runs here: `validateCacheEntry`
 * is called against the requested URL. A mismatch logs a warning
 * via the supplied `notify` callback and skips the persist — the
 * original `FetchResult` is returned unchanged so the caller can
 * decide what to do with it (typically: return it to the user;
 * the next call will re-fetch from the provider).
 *
 * BUG-2026-06-06-JGCMZSET-YZOYE / BUG-2026-06-06-JGCMZSNR-YZOYE:
 * when the result carries a `providerError` (the browser was
 * tried and failed, the static fallback is what's in the
 * result), the cache write is skipped for transient reasons
 * (`timeout`, `navigation_failed`). The next call within the
 * same TTL re-attempts the browser. A `low_text_ratio` /
 * `unknown` reason is a deterministic classification and is
 * safe to cache.
 */
export async function cacheFetchResult(
	result: FetchResult,
	options?: CacheKeyOptions | CacheFetchOptions,
	notify?: (message: string, level: 'info' | 'warn' | 'error') => void,
): Promise<FetchResult> {
	const url = result.details.url;
	if (shouldSkipCache(url)) return result;

	// Skip the cache write when the result is a fallback from
	// a transient provider error. The user should be able to
	// retry the URL and have the next call re-attempt the
	// browser; a cached fallback defeats that.
	const pe = result.details.providerError;
	if (pe && isTransientProviderErrorReason(pe.reason)) {
		const message = `webfetch: cache write rejected — provider ${pe.provider} failed transiently (${pe.reason}); next call will re-attempt`;
		notify?.(message, 'warn');
		result.details.notify = message;
		return result;
	}

	const entry = buildCacheEntry(result);
	if (!entry) return result;

	// Content validation: a race condition between concurrent
	// fetches (e.g. shared browser tab) can cause the provider to
	// extract HTML for the wrong URL. Cross-check the rendered
	// `finalUrl` / `pageTitle` / raw `<title>` against the
	// requested URL; reject on mismatch.
	const validation = validateCacheEntry(
		{
			finalUrl: entry.finalUrl,
			pageTitle: entry.pageTitle,
			rawContent: entry.rawContent,
			url: entry.url,
		},
		url,
	);
	if (!validation.valid) {
		const message = `webfetch: cache write rejected — ${validation.reason ?? 'content validation failed'}`;
		notify?.(message, 'warn');
		// Mirror the warning on the details so the CLI / MCP /
		// extension can surface it in `_meta.details.notify`
		// even when the caller did not pass a notify shim.
		result.details.notify = message;
		return result;
	}

	try {
		await setCache(url, entry, options);
	} catch {
		// Cache write failure is non-fatal
	}

	return result;
}

/**
 * Get cached result if available, honoring `options.cacheTtlMs`.
 * A stale entry is dropped (treated as a miss) so callers always
 * see a fresh read; the file on disk is left in place for the
 * `clearCacheOlderThan` path to pick up.
 */
export async function getCachedResult(
	url: string,
	options?: CacheKeyOptions | CacheFetchOptions,
): Promise<FetchResult | null> {
	if (shouldSkipCache(url)) return null;

	const cached = await getCache(url, options);
	if (!cached) return null;

	const now = options && 'now' in options && options.now ? options.now() : Date.now();
	const ttl = options && 'cacheTtlMs' in options ? options.cacheTtlMs : undefined;
	if (!isFresh(cached, now, ttl)) return null;

	const cacheAge = now - cached.cachedAt;
	const details: WebfetchDetails = {
		url,
		contentType: cached.contentType,
		status: cached.status,
		// v0.9.0 (M3.C): the cache hit was previously
		// reported as `processedAs: 'fallback'`, which the
		// user-facing `Processed as: ...` header displayed
		// as `fallback` (confusing — it reads as a
		// graceful-degradation case, not a cache hit). The
		// widened union now has a dedicated `cache` value.
		processedAs: 'cache',
		provider: cached.provider,
		extractionMethod: cached.extractionMethod,
		cached: true,
		cacheAge,
		// Forward the persisted raw payload (if any) so the research
		// service can still write `input_raw.<ext>` when the fetch
		// was served from cache.
		...(cached.rawContent !== undefined ? { rawContent: cached.rawContent } : {}),
		...(cached.rawContentType !== undefined ? { rawContentType: cached.rawContentType } : {}),
	};

	// Append cache footer to content
	const cacheFooter = `\n\n---\n\n> 💾 *Cached result from ${formatAge(cacheAge)}*`;

	return {
		content: [{ type: 'text' as const, text: cached.content + cacheFooter }],
		details,
	};
}
