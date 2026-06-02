/**
 * Webfetch Cache Commands
 *
 * Registers cache-related commands for the pi extension.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { getCacheStats } from '../cache.js';

/**
 * Register the webfetch:cache command for viewing cache stats
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
}