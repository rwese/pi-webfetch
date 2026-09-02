// Cache management for webfetch results
// Stores fetched content in temp directory based on URL hash

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const CACHE_DIR = join(tmpdir(), 'pi-webfetch-cache');

// Ensure cache directory exists
async function ensureCacheDir(): Promise<void> {
	try {
		await mkdir(CACHE_DIR, { recursive: true });
	} catch {
		// Directory may already exist
	}
}

/**
 * Optional cache key modifiers. Callers that pass a `cacheKey` get a
 * separate cache entry for that key, which lets them avoid stale
 * results when the same URL can produce different content for
 * different request options (e.g. `includeComments` on GitHub URLs).
 */
export interface CacheKeyOptions {
	cacheKey?: string;
}

/**
 * Generate a safe filename from URL (and an optional cache key suffix)
 * using SHA256 hash. The key suffix is mixed in so two callers asking
 * for the same URL with different options do not collide.
 */
function urlToCacheKey(url: string, options?: CacheKeyOptions): string {
	const suffix = options?.cacheKey ? `:${options.cacheKey}` : '';
	const hash = createHash('sha256').update(`${url}${suffix}`).digest('hex');
	// First 32 chars of hash should be unique enough
	return hash.slice(0, 32);
}

/**
 * Get the cache file path for a URL
 */
function getCachePath(url: string, options?: CacheKeyOptions): string {
	const key = urlToCacheKey(url, options);
	return join(CACHE_DIR, `${key}.json`);
}

export interface CacheEntry {
	url: string;
	content: string;
	contentType: string | null;
	status: number;
	cachedAt: number;
	/**
	 * Final URL after redirects, when the provider surfaces it.
	 * Used by `validateCacheEntry` to defend against the
	 * poisoned-cache case where a race condition (e.g. shared
	 * browser tab) caused the provider to extract HTML for the
	 * wrong URL. When present, the cache write is rejected
	 * unless the requested URL matches `finalUrl` (or a
	 * fuzzy-URL-derived title match succeeds).
	 */
	finalUrl?: string;
	/**
	 * Page `<title>` extracted from the rendered HTML, when the
	 * provider surfaces it. Used as a secondary content-validation
	 * signal in `validateCacheEntry`.
	 */
	pageTitle?: string;
	provider?: string;
	extractionMethod?: string;
	/**
	 * Original un-processed response (e.g. raw HTML for browser
	 * providers, raw text for static fetch). Persisted so a
	 * research subagent that hits the cache can still write
	 * `input_raw.<ext>` in its session work dir. `undefined` for
	 * providers that don't expose raw (gh-cli, clawfetch, ...).
	 */
	rawContent?: string;
	/** MIME type hint for `rawContent`. */
	rawContentType?: string | null;
}

/**
 * Store content in cache
 */
export async function setCache(
	url: string,
	data: CacheEntry,
	options?: CacheKeyOptions,
): Promise<void> {
	await ensureCacheDir();
	const cachePath = getCachePath(url, options);
	const entry: CacheEntry = {
		...data,
		url,
		cachedAt: Date.now(),
	};
	await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
}

/**
 * Get cached content for a URL
 */
export async function getCache(url: string, options?: CacheKeyOptions): Promise<CacheEntry | null> {
	try {
		const cachePath = getCachePath(url, options);
		const data = await readFile(cachePath, 'utf-8');
		const entry: CacheEntry = JSON.parse(data);
		return entry;
	} catch {
		// Cache miss or read error
		return null;
	}
}

/**
 * Check if URL is cached
 */
// fallow-ignore-next-line unused-export
export async function hasCache(url: string, options?: CacheKeyOptions): Promise<boolean> {
	const cachePath = getCachePath(url, options);
	try {
		await readFile(cachePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the age of cached content in milliseconds
 */
// fallow-ignore-next-line unused-export
export async function getCacheAge(url: string, options?: CacheKeyOptions): Promise<number | null> {
	const entry = await getCache(url, options);
	if (!entry) return null;
	return Date.now() - entry.cachedAt;
}

/**
 * Clear cache for a specific URL and cache key. With no `cacheKey`
 * provided, the default (URL-only) entry is cleared. Pass the same
 * `cacheKey` that was used for the cached read/write to drop the
 * matching entry.
 */
export async function clearCache(url: string, options?: CacheKeyOptions): Promise<boolean> {
	try {
		const cachePath = getCachePath(url, options);
		await rm(cachePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Options for batch cache clears.
 *
 * - `olderThanMs`: only clear entries whose `cachedAt` is at least
 *   this many milliseconds in the past. `undefined` clears every
 *   entry. Used by `webfetch-clear-cache --older-than <duration>`
 *   and `--all` (the latter is just `clearAllCache({})`).
 */
export interface ClearCacheOptions {
	olderThanMs?: number;
}

/**
 * Clear all cached content. With `olderThanMs` set, only entries
 * whose `cachedAt` is at least that many ms in the past are
 * removed; fresh entries are kept.
 */
export async function clearAllCache(options: ClearCacheOptions = {}): Promise<number> {
	await ensureCacheDir();
	const files = await readdir(CACHE_DIR);
	const now = Date.now();
	let count = 0;
	for (const file of files) {
		if (!file.endsWith('.json')) continue;
		const path = join(CACHE_DIR, file);
		if (options.olderThanMs !== undefined) {
			try {
				const data = await readFile(path, 'utf-8');
				const entry = JSON.parse(data) as CacheEntry;
				if (now - entry.cachedAt < options.olderThanMs) {
					continue;
				}
			} catch {
				// Corrupt or unreadable entry: drop it (the user asked
				// to clear, the file is unusable).
			}
		}
		await rm(path);
		count++;
	}
	return count;
}

/**
 * Clear a single cached URL, but only when the entry is at least
 * `olderThanMs` old. Returns `true` when a file was removed, `false`
 * otherwise (no entry, fresh entry, or unreadable entry).
 */
export async function clearCacheOlderThan(
	url: string,
	olderThanMs: number,
	options?: CacheKeyOptions,
): Promise<boolean> {
	const entry = await getCache(url, options);
	if (!entry) return false;
	if (Date.now() - entry.cachedAt < olderThanMs) return false;
	return clearCache(url, options);
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
	await ensureCacheDir();
	const files = await readdir(CACHE_DIR);
	const jsonFiles = files.filter((f) => f.endsWith('.json'));
	let totalSize = 0;

	for (const file of jsonFiles) {
		try {
			const stat = await readFile(join(CACHE_DIR, file));
			totalSize += stat.byteLength;
		} catch {
			// Ignore errors
		}
	}

	return { count: jsonFiles.length, totalSize };
}

/**
 * Default cache TTL. 1 hour is short enough that a "1 day ago"
 * entry cannot haunt the current session and long enough to
 * dedupe repeat fetches inside a single user session.
 */
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * True when the entry is still inside the TTL window. A
 * non-finite or non-positive `ttlMs` is treated as "always stale"
 * — callers that want a different TTL pass a positive integer;
 * we never expose a "no TTL" mode to defend against the
 * poisoned-cache case (review finding 1).
 */
export function isFresh(entry: Pick<CacheEntry, 'cachedAt'>, now: number, ttlMs?: number): boolean {
	const ttl = ttlMs ?? DEFAULT_CACHE_TTL_MS;
	if (!Number.isFinite(ttl) || ttl <= 0) return false;
	const age = now - entry.cachedAt;
	return age >= 0 && age < ttl;
}

/**
 * Parse a human-friendly duration string (e.g. `7d`, `2h`, `30m`,
 * `45s`, `1500ms`) into milliseconds. Returns `null` for malformed
 * input. Used by `webfetch-clear-cache --older-than <duration>`.
 *
 * Supported units:
 *
 * - `ms` / milliseconds
 * - `s`  / seconds
 * - `m`  / minutes
 * - `h`  / hours
 * - `d`  / days (24h)
 *
 * Bare integers are interpreted as milliseconds (matches the
 * `--cache-ttl <ms>` convention).
 */
export function parseDurationToMs(value: string): number | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(trimmed);
	if (!match) return null;
	const n = Number(match[1]);
	if (!Number.isFinite(n) || n < 0) return null;
	const unit = (match[2] ?? 'ms').toLowerCase();
	switch (unit) {
		case 'ms':
			return n;
		case 's':
			return n * 1000;
		case 'm':
			return n * 60 * 1000;
		case 'h':
			return n * 60 * 60 * 1000;
		case 'd':
			return n * 24 * 60 * 60 * 1000;
		default:
			return null;
	}
}

/**
 * Format age in human-readable format
 */
export function formatAge(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

	const months = Math.floor(days / 30);
	if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

	const years = Math.floor(months / 12);
	return `${years} year${years === 1 ? '' : 's'} ago`;
}
