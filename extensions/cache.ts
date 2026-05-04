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
 * Generate a safe filename from URL using SHA256 hash
 */
function urlToCacheKey(url: string): string {
	const hash = createHash('sha256').update(url).digest('hex');
	// First 32 chars of hash should be unique enough
	return hash.slice(0, 32);
}

/**
 * Get the cache file path for a URL
 */
function getCachePath(url: string): string {
	const key = urlToCacheKey(url);
	return join(CACHE_DIR, `${key}.json`);
}

export interface CacheEntry {
	url: string;
	content: string;
	contentType: string | null;
	status: number;
	cachedAt: number;
	provider?: string;
	extractionMethod?: string;
}

/**
 * Store content in cache
 */
export async function setCache(url: string, data: CacheEntry): Promise<void> {
	await ensureCacheDir();
	const cachePath = getCachePath(url);
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
export async function getCache(url: string): Promise<CacheEntry | null> {
	try {
		const cachePath = getCachePath(url);
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
export async function hasCache(url: string): Promise<boolean> {
	const cachePath = getCachePath(url);
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
export async function getCacheAge(url: string): Promise<number | null> {
	const entry = await getCache(url);
	if (!entry) return null;
	return Date.now() - entry.cachedAt;
}

/**
 * Clear cache for a specific URL
 */
export async function clearCache(url: string): Promise<boolean> {
	try {
		const cachePath = getCachePath(url);
		await rm(cachePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Clear all cached content
 */
export async function clearAllCache(): Promise<number> {
	await ensureCacheDir();
	const files = await readdir(CACHE_DIR);
	let count = 0;
	for (const file of files) {
		if (file.endsWith('.json')) {
			await rm(join(CACHE_DIR, file));
			count++;
		}
	}
	return count;
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
