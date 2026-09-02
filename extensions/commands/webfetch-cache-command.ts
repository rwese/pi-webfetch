/**
 * Webfetch Cache Commands
 *
 * Registers cache-related commands for the pi extension.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { clearAllCache, clearCache, getCacheStats, parseDurationToMs } from '../cache.js';

/**
 * Format a millisecond count as a short, human-readable duration.
 * Mirrors the formatting in `extensions/cli.ts::formatMs` so the
 * TUI notify and the CLI stderr line up.
 */
function formatMs(ms: number): string {
	if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
	if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
	if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

/**
 * Parse a `/webfetch-clear-cache <args>` argument string into a
 * normalised command. Accepts:
 *
 * - `/webfetch-clear-cache`                 -> clear all
 * - `/webfetch-clear-cache --all`           -> clear all
 * - `/webfetch-clear-cache <url>`           -> clear one URL
 * - `/webfetch-clear-cache --older-than 7d` -> clear older entries
 * - `/webfetch-clear-cache --dry-run ...`   -> describe what would happen
 *
 * Bare URLs are detected by the `http://` / `https://` prefix. The
 * parser is intentionally tiny so the TUI autocomplete stays
 * simple; richer parsing happens in `extensions/cli.ts`.
 */
function parseClearCacheArgs(raw: string): {
	url?: string;
	all: boolean;
	olderThanMs?: number;
	dryRun: boolean;
	error?: string;
} {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const result: {
		url?: string;
		all: boolean;
		olderThanMs?: number;
		dryRun: boolean;
		error?: string;
	} = { all: false, dryRun: false };

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === '--all') {
			result.all = true;
		} else if (token === '--dry-run') {
			result.dryRun = true;
		} else if (token === '--older-than') {
			const value = tokens[i + 1];
			if (!value) {
				result.error = 'Missing value for --older-than';
				return result;
			}
			const ms = parseDurationToMs(value);
			if (ms === null) {
				result.error = `Invalid --older-than '${value}' (expected <n>d|h|m|s|ms)`;
				return result;
			}
			result.olderThanMs = ms;
			i++;
		} else if (token.startsWith('http://') || token.startsWith('https://')) {
			result.url = token;
		} else {
			result.error = `Unknown argument: ${token}`;
			return result;
		}
	}
	return result;
}

/**
 * Register the webfetch:cache command for viewing cache stats
 * and the webfetch:clear-cache command for batch UX.
 */
export function registerWebfetchCacheCommand(pi: ExtensionAPI): void {
	pi.registerCommand('webfetch:cache', {
		description: 'Show webfetch cache statistics',
		handler: async (_args, ctx) => {
			const stats = await getCacheStats();
			const sizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);

			const lines = [
				'## Cache Statistics',
				'',
				`| Cached items | ${stats.count} |`,
				`| Total size | ${sizeMB} MB |`,
			];

			ctx.ui.notify(lines.join('\n'), 'info');
		},
	});

	pi.registerCommand('webfetch:clear-cache', {
		description:
			'Clear cached URLs. Usage: /webfetch-clear-cache [<url>] [--all] [--older-than <duration>] [--dry-run]',
		getArgumentCompletions: (_prefix: string) => null,
		handler: async (args, ctx) => {
			const parsed = parseClearCacheArgs(args ?? '');
			if (parsed.error) {
				ctx.ui.notify(`webfetch-clear-cache: ${parsed.error}`, 'error');
				return;
			}

			if (parsed.url) {
				const cleared = await clearCache(parsed.url);
				ctx.ui.notify(
					cleared
						? `Cache cleared for: ${parsed.url}`
						: `No cache entry found for: ${parsed.url}`,
					cleared ? 'info' : 'warning',
				);
				return;
			}

			if (parsed.dryRun) {
				const stats = await getCacheStats();
				const filter =
					parsed.olderThanMs !== undefined
						? `entries older than ${formatMs(parsed.olderThanMs)}`
						: parsed.all
							? 'all entries'
							: 'all entries';
				ctx.ui.notify(
					`Dry run: would clear ${filter} (${stats.count} entries, ${(
						stats.totalSize /
						(1024 * 1024)
					).toFixed(2)} MB on disk).`,
					'info',
				);
				return;
			}

			const clearedCount = await clearAllCache(
				parsed.olderThanMs !== undefined ? { olderThanMs: parsed.olderThanMs } : {},
			);
			const tail =
				parsed.olderThanMs !== undefined
					? ` older than ${formatMs(parsed.olderThanMs)}`
					: '';
			ctx.ui.notify(`Cleared ${clearedCount} cached item(s)${tail}`, 'info');
		},
	});
}
