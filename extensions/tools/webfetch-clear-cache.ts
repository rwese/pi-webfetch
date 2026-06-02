/**
 * Webfetch Clear Cache Tool Registration
 *
 * Registers the webfetch-clear-cache tool with the pi extension.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { clearCache, clearAllCache } from '../cache.js';

/**
 * Webfetch clear cache tool parameters
 */
export const WEBFETCH_CLEAR_CACHE_PARAMS = Type.Object({
	url: Type.Optional(
		Type.String({ description: 'Specific URL to clear from cache. If omitted, clears all cache.' }),
	),
});

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