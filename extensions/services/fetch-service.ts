/**
 * Fetch Service
 *
 * Main orchestration for URL fetching with provider selection.
 */

import type {
	WebfetchDetails,
	FetchResult,
	ProviderConfig,
	ProviderFetchResult,
	GitHubFetchOptions,
} from '../types.js';
import {
	removeMarkdownAnchors,
	extractEmbeddedImages,
	unescapeBrackets,
} from '../markdown.js';
import { providerDisplayName } from '../providers/display-name.js';
import { truncateToSize, getTempFilePath } from '../utils/formatting.js';
import { isLikelyBinaryUrl } from '../utils/url.js';
import { getExtensionFromContentType } from '../content-types.js';
import { buildFetchHeader } from './header-builder.js';
import { cacheFetchResult, getCachedResult } from './cache-service.js';
import { staticFetch, handleBinary } from './static-fetch.js';
import { getProviderManager } from './session-manager.js';
import { ProviderError } from '../../src/providers/types.js';
import type { CacheKeyOptions } from '../cache.js';

const MAX_MARKDOWN_SIZE = 100 * 1024;

/** Provider fetch options (CLI / MCP / pi extension all funnel through this). */
export interface ProviderFetchOptions {
	/** GitHub-specific fetch options. Forwarded to the gh-cli provider. */
	github?: GitHubFetchOptions;
	/**
	 * Per-call cache TTL override in milliseconds. Falls back to
	 * `DEFAULT_CACHE_TTL_MS` (1 hour). Threads the
	 * `--cache-ttl <ms>` / `cacheTtlMs` flag from the CLI / MCP /
	 * extension / pi-tool surfaces down to the cache layer.
	 * Pinned in v0.9.0 (review finding 1).
	 */
	cacheTtlMs?: number;
	/**
	 * Per-call clock injection. Defaults to `() => Date.now()`.
	 * The cache TTL check uses this so tests can assert
	 * "fresh" / "stale" / "override" without mutating the
	 * system clock. Production callers never pass it.
	 */
	cacheNow?: () => number;
	/**
	 * Optional notify channel for cache-validation warnings
	 * (e.g. "cache write rejected: title mismatch"). The CLI /
	 * MCP / extension surfaces pass their own channel; in-process
	 * callers that omit it get the warning mirrored onto
	 * `WebfetchDetails.notify` instead.
	 */
	cacheNotify?: (message: string, level: 'info' | 'warn' | 'error') => void;
}

/**
 * Pull a `githubHint` string out of a provider's `metadata` record. The
 * extension's `ProviderFetchResult.metadata` is a `Record<string, unknown>`,
 * so we coerce carefully to keep the call site simple.
 */
function readGithubHint(metadata: unknown): string | undefined {
	if (!metadata || typeof metadata !== 'object') return undefined;
	const hint = (metadata as Record<string, unknown>).githubHint;
	return typeof hint === 'string' && hint.length > 0 ? hint : undefined;
}

/**
 * Build a stable cache key suffix from provider fetch options. The cache
 * uses URL-only keys by default; when an option affects the rendered
 * output (e.g. `includeComments`), we need a separate cache entry so the
 * first call does not poison subsequent calls.
 */
function buildCacheKeyFromOptions(options?: ProviderFetchOptions): CacheKeyOptions {
	if (!options?.github) return {};
	// Stable JSON serialisation - sort keys so the same options always
	// produce the same key, regardless of declaration order.
	const sortedKeys = Object.keys(options.github).sort();
	const canonical: Record<string, unknown> = {};
	for (const key of sortedKeys) {
		canonical[key] = (options.github as Record<string, unknown>)[key];
	}
	return { cacheKey: JSON.stringify(canonical) };
}

/**
 * Pick the cache TTL and clock injection out of a
 * `ProviderFetchOptions` (or any superset) so the cache layer
 * can honour a per-call override. Returns the previous
 * `CacheKeyOptions` shape plus the TTL / clock fields, which
 * `CacheFetchOptions` understands.
 */
function buildCacheFetchOptions(
	options?: ProviderFetchOptions,
): CacheKeyOptions & { cacheTtlMs?: number; now?: () => number } {
	const key = buildCacheKeyFromOptions(options);
	if (options?.cacheTtlMs === undefined && options?.cacheNow === undefined) {
		return key;
	}
	return {
		...key,
		...(options?.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
		...(options?.cacheNow ? { now: options.cacheNow } : {}),
	};
}

/**
 * Main webfetch function - auto-detects best fetch method
 */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	provider?: string,
	options?: ProviderFetchOptions,
): Promise<FetchResult> {
	const cacheKey = buildCacheFetchOptions(options);

	// Check cache first (scoped to the option-set so different option
	// combinations cannot poison each other).
	const cached = await getCachedResult(url, cacheKey);
	if (cached) {
		return cached;
	}

	// Check if URL is likely binary
	if (isLikelyBinaryUrl(url)) {
		return cacheFetchResult(
			await handleBinary(url, fetchFn),
			cacheKey,
			(message, level) => writeNotify(options, message, level),
		);
	}

	// Check for provider-based fetch (default for HTML content)
	const manager = await getProviderManager();
	const hostname = new URL(url).hostname.toLowerCase();
	const isRawGitHubUrl = hostname === 'raw.githubusercontent.com';

	// Use provider by default for HTML content; static fetch only for:
	// - Raw GitHub URLs (machine-readable format)
	// - When explicitly requested via provider: "none"
	const shouldUseProvider = !isRawGitHubUrl && provider !== 'none';

	// BUG-2026-06-06-JGCMZSET-YZOYE / BUG-2026-06-06-JGCMZSNR-YZOYE:
	// capture the provider error so the static fallback can
	// carry it on `details.providerError` (and the cache layer
	// can decide whether the fallback is transient).
	let providerError: WebfetchDetails['providerError'] | undefined;

	if (shouldUseProvider) {
		try {
			const config: ProviderConfig & { provider?: string } = {
				provider: provider || undefined,
				github: options?.github,
			};
			const providerResult = await manager.fetch(url, config);

			if (providerResult && 'content' in providerResult) {
				return processProviderResult(
					providerResult as ProviderFetchResult,
					url,
					cacheKey,
					options,
				);
			}
		} catch (error) {
			// Provider failed. BUG-2026-06-06-JGCMZSET-YZOYE /
			// BUG-2026-06-06-JGCMZSNR-YZOYE: surface the cause
			// to the user and to the next call (so a transient
			// timeout does not poison the cache with a static
			// fallback). The fetch service used to swallow the
			// error silently; the user had no way to tell the
			// browser was abandoned.
			providerError = classifyProviderError(error, provider);
			const warning = `webfetch: ${providerError.provider} provider failed (${providerError.reason}) for ${url}: ${providerError.message}; falling back to static fetch`;
			// Surface on the optional notify channel (TUI on
			// the extension, stderr on the CLI, _meta.details
			// on the MCP).
			writeNotify(options, warning, 'warn');
		}
	}

	// Fallback to static fetch
	const fallback = await staticFetch(url, fetchFn);
	if (providerError) {
		// Forward the provider error onto the fallback's
		// details so the user-facing header can read it
		// (e.g. `Provider: browser (failed: navigation_failed)`)
		// and the in-content warning can quote the cause.
		// The cache layer reads `details.providerError.reason`
		// to decide whether the fallback is transient (skip
		// the cache write) or safe to persist.
		fallback.details.providerError = providerError;
	}
	return cacheFetchResult(
		fallback,
		cacheKey,
		(message, level) => writeNotify(options, message, level),
	);
}

/**
 * Classify a provider failure into a `providerError` record
 * suitable for `WebfetchDetails.providerError`. Recognises
 * the in-tree `ProviderError` class (default provider) and
 * maps its `reason` through. Any other thrown value gets
 * `reason: 'unknown'` and a stringified message.
 */
function classifyProviderError(
	error: unknown,
	providerHint: string | undefined,
): NonNullable<WebfetchDetails['providerError']> {
	if (error instanceof ProviderError) {
		return {
			provider: error.providerName,
			reason: error.reason,
			message: error.message,
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return {
		provider: providerHint ?? 'browser',
		reason: 'unknown',
		message,
	};
}

/**
 * Surface a `cacheFetchResult` warning on the optional
 * `options.cacheNotify` channel. The CLI / MCP / extension
 * surfaces wire their own channel; in-process callers that
 * pass `options.cacheNotify` get the same line via a single
 * shim. Centralised so the test suite can assert on it
 * without touching the real notify surfaces.
 */
function writeNotify(
	options: ProviderFetchOptions | undefined,
	message: string,
	level: 'info' | 'warn' | 'error',
): void {
	options?.cacheNotify?.(message, level);
}

/**
 * Process result from a provider
 */
async function processProviderResult(
	result: ProviderFetchResult,
	url: string,
	cacheKey: CacheKeyOptions = {},
	options?: ProviderFetchOptions,
): Promise<FetchResult> {
	const originalSize = Buffer.byteLength(result.content, 'utf-8');
	let cleanedContent = removeMarkdownAnchors(result.content);
	cleanedContent = unescapeBrackets(cleanedContent);

	// Extract embedded images to temp file
	const imageResult = await extractEmbeddedImages(cleanedContent);
	cleanedContent = imageResult.content;

	const truncated = originalSize > MAX_MARKDOWN_SIZE;
	let content = truncateToSize(cleanedContent, MAX_MARKDOWN_SIZE);
	if (imageResult.tempFilePath) {
		content += `\n\n> 📎 **Embedded images** extracted to: ${imageResult.tempFilePath}`;
	}

	// Surface a provider's discovery hint (e.g. gh-cli advertising
	// `includeComments`) in both the content tail and `details.githubHint`.
	// Providers that already appended the hint to `content` won't get a
	// duplicate because we only append when `metadata.githubHint` is set
	// but the hint string is not already present at the end of content.
	const githubHint = readGithubHint(result.metadata);
	if (githubHint && !content.includes(githubHint)) {
		content = `${content}\n\n${githubHint}`;
	}

	const details: WebfetchDetails = {
		url,
		contentType: result.contentType,
		status: result.status,
		processedAs: 'spa',
		originalSize,
		tempFileSize: Buffer.byteLength(content, 'utf-8'),
		truncated,
		extracted: true,
		provider: providerDisplayName(result.providerName),
		extractionMethod: result.extractionMethod,
		...(githubHint ? { githubHint } : {}),
		// Forward the provider's raw payload (browser HTML, etc.) so
		// the research service can write `input_raw.<ext>` in the
		// session work dir. Providers that don't expose raw leave
		// these as `undefined`; the spread keeps the field out of
		// the result object in that case.
		...(result.rawContent !== undefined ? { rawContent: result.rawContent } : {}),
		...(result.rawContentType !== undefined
			? { rawContentType: result.rawContentType }
			: {}),
		// Content-validation signals: forward the provider's
		// `finalUrl` (the URL the provider actually rendered, after
		// redirects) and the rendered `<title>` (when surfaced via
		// `metadata.title`) so `cacheFetchResult` can confirm the
		// cache write is for the requested URL.
		...(result.finalUrl ? { finalUrl: result.finalUrl } : {}),
		...(readPageTitle(result.metadata) ? { pageTitle: readPageTitle(result.metadata) } : {}),
	};

	return cacheFetchResult(
		{
			content: [{ type: 'text' as const, text: buildFetchHeader(details) + content }],
			details,
		},
		cacheKey,
		(message, level) => writeNotify(options, message, level),
	);
}

/**
 * Pull a `pageTitle` string out of a provider's `metadata` record.
 * The default provider surfaces the rendered `<title>` under
 * `metadata.title`; this shim keeps the call site clean.
 */
function readPageTitle(metadata: unknown): string | undefined {
	if (!metadata || typeof metadata !== 'object') return undefined;
	const title = (metadata as Record<string, unknown>).title;
	return typeof title === 'string' && title.length > 0 ? title : undefined;
}

/**
 * Explicit browser-based fetch for SPAs
 */
export async function webfetchSPA(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000,
	options?: ProviderFetchOptions,
): Promise<FetchResult> {
	const cacheKey = buildCacheFetchOptions(options);

	// Check cache first
	const cached = await getCachedResult(url, cacheKey);
	if (cached) {
		return cached;
	}

	const manager = await getProviderManager();
	const config: ProviderConfig = {
		timeout,
		waitFor: waitFor as 'networkidle' | 'domcontentloaded',
		github: options?.github,
	};
	let result;
	try {
		result = await manager.fetch(url, config);
	} catch (error) {
		// BUG-2026-06-06-JGCMZSET-YZOYE: same surface
		// path as `fetchUrl`. Classify the cause, warn the
		// user, and fall through to the static-fetch path
		// with the error attached to `details.providerError`.
		const providerError = classifyProviderError(error, undefined);
		const warning = `webfetch: ${providerError.provider} provider failed (${providerError.reason}) for ${url}: ${providerError.message}; falling back to static fetch`;
		writeNotify(options, warning, 'warn');
		const fallback = await staticFetch(url, fetch);
		fallback.details.providerError = providerError;
		return cacheFetchResult(
			fallback,
			cacheKey,
			(message, level) => writeNotify(options, message, level),
		);
	}

	if (result && 'content' in result) {
		const providerResult = result as ProviderFetchResult;
		let cleanedText = removeMarkdownAnchors(providerResult.content);
		cleanedText = unescapeBrackets(cleanedText);

		// Extract embedded images
		const imageResult = await extractEmbeddedImages(cleanedText);
		cleanedText = imageResult.content;

		const originalSize = Buffer.byteLength(providerResult.content, 'utf-8');
		const truncated = originalSize > MAX_MARKDOWN_SIZE;
		let finalText = truncateToSize(cleanedText, MAX_MARKDOWN_SIZE);
		if (imageResult.tempFilePath) {
			finalText += `\n\n> 📎 **Embedded images** extracted to: ${imageResult.tempFilePath}`;
		}

		// Surface provider discovery hint (e.g. gh-cli's includeComments tip).
		const githubHint = readGithubHint(providerResult.metadata);
		if (githubHint && !finalText.includes(githubHint)) {
			finalText = `${finalText}\n\n${githubHint}`;
		}

		const details: WebfetchDetails = {
			url,
			contentType: providerResult.contentType,
			status: providerResult.status,
			processedAs: 'spa',
			originalSize,
			tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
			truncated,
			extracted: true,
			provider: providerDisplayName(providerResult.providerName),
			extractionMethod: providerResult.extractionMethod,
			...(githubHint ? { githubHint } : {}),
			// Same raw-payload forwarding as in fetchUrl above.
			...(providerResult.rawContent !== undefined
				? { rawContent: providerResult.rawContent }
				: {}),
			...(providerResult.rawContentType !== undefined
				? { rawContentType: providerResult.rawContentType }
				: {}),
			// Content-validation signals: same forwarding as in
			// fetchUrl above. The static-fetch fallback below
			// bypasses `processProviderResult` so it has to set
			// these fields itself (or skip them — the static path
			// surfaces `rawContent` / `rawContentType` but the
			// title heuristic is brittle for raw.githubusercontent
			// URLs and other non-HTML inputs).
			...(providerResult.finalUrl ? { finalUrl: providerResult.finalUrl } : {}),
			...(readPageTitle(providerResult.metadata)
				? { pageTitle: readPageTitle(providerResult.metadata) }
				: {}),
		};

		return cacheFetchResult(
			{
				content: [{ type: 'text' as const, text: buildFetchHeader(details) + finalText }],
				details,
			},
			cacheKey,
			(message, level) => writeNotify(options, message, level),
		);
	}

	// Fallback
	return staticFetch(url, fetch);
}

/**
 * Download file to temp location
 */
export async function downloadFile(
	url: string,
	fetchFn: typeof fetch = fetch,
): Promise<{ tempPath: string; contentType: string | null }> {
	const response = await fetchFn(url);
	const contentType = response.headers.get('content-type');
	const extension = getExtensionFromContentType(contentType, url);
	const tempPath = getTempFilePath('webfetch-download', extension);
	const buffer = Buffer.from(await response.arrayBuffer());

	const fs = await import('node:fs');
	fs.writeFileSync(tempPath, buffer);

	return { tempPath, contentType };
}
