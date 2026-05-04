/**
 * Webfetch Cache Tools Registration
 *
 * Registers cache-related tools for managing the webfetch cache.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { clearCache, clearAllCache, getCacheStats } from '../cache.js';

/**
 * Webfetch clear cache tool parameters
 */
export const WEBFETCH_CLEAR_CACHE_PARAMS = Type.Object({
	url: Type.Optional(
		Type.String({ description: 'Specific URL to clear from cache. If omitted, clears all cache.' }),
	),
});

/**
 * Webfetch cache stats tool parameters (empty)
 */
export const WEBFETCH_CACHE_STATS_PARAMS = Type.Object({});

/**
 * Register the webfetch clear cache tool with the pi extension
 */
export function registerWebfetchClearCacheTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'webfetch-clear-cache',
		label: 'Clear Web Fetch Cache',
		description: 'Clear cached content for a specific URL, or all cached content',
		parameters: WEBFETCH_CLEAR_CACHE_PARAMS,
		async execute(_toolCallId, params, _signal) {
			interface ClearCacheDetails {
				url?: string;
				cleared?: boolean;
				clearedCount?: number;
			}

			let result: { content: Array<{ type: 'text'; text: string }>; details: ClearCacheDetails };

			if (params.url) {
				// Clear specific URL
				const cleared = await clearCache(params.url);
				result = {
					content: [{ type: 'text' as const, text: cleared ? `✅ Cache cleared for: ${params.url}` : `ℹ️ No cache entry found for: ${params.url}` }],
					details: { url: params.url, cleared },
				};
			} else {
				// Clear all
				const count = await clearAllCache();
				result = {
					content: [{ type: 'text' as const, text: `✅ Cleared ${count} cached item(s)` }],
					details: { clearedCount: count },
				};
			}
			return result;
		},
	});
}

/**
 * Register the webfetch cache stats tool with the pi extension
 */
export function registerWebfetchCacheStatsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'webfetch-cache-stats',
		label: 'Web Fetch Cache Stats',
		description: 'Get statistics about cached webfetch content',
		parameters: WEBFETCH_CACHE_STATS_PARAMS,
		async execute(_toolCallId, _params, _signal) {
			const stats = await getCacheStats();
			const sizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);

			const lines = [
				'## Cache Statistics',
				'',
				`| Cached items | ${stats.count} |`,
				`| Total size | ${sizeMB} MB |`,
				'',
				'### Commands',
				'',
				'- `webfetch-clear-cache` - Clear all cached content',
				'- `webfetch-clear-cache --url "<url>"` - Clear cache for specific URL',
			];

			return {
				content: [{ type: 'text', text: lines.join('\n') }],
				details: stats,
			};
		},
	});
}
