/**
 * Webfetch Command Handler
 *
 * Handles the /webfetch flash command for quick URL fetching.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { webfetchResearch } from '../fetch.js';
import { getCommandPhaseLabel } from '../helpers.js';

/**
 * Register the webfetch command handler
 */
export function registerWebfetchCommand(pi: ExtensionAPI): void {
	// Flash command: /webfetch <url> - Fetch a URL directly
	// Also supports: /webfetch <url> <query> for research mode
	pi.registerCommand('webfetch', {
		description: 'Fetch a URL, optionally with a research query',
		getArgumentCompletions: (_prefix: string) => null,
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify('Usage: /webfetch <url> [query]', 'error');
				return;
			}

			// Parse URL and optional query
			// URL could be quoted or unquoted
			const trimmed = args.trim();
			let url: string;
			let query: string | undefined;

			// Check if first arg is quoted (multi-word URL or has query)
			if (trimmed.startsWith('"')) {
				const endQuote = trimmed.indexOf('"', 1);
				if (endQuote > 0) {
					url = trimmed.slice(1, endQuote);
					// Extract query after the closing quote, strip surrounding quotes if present
					const afterQuote = trimmed.slice(endQuote + 1).trim();
					if (afterQuote.startsWith('"') && afterQuote.endsWith('"')) {
						query = afterQuote.slice(1, -1).trim() || undefined;
					} else if (afterQuote.startsWith("'")) {
						const singleEnd = afterQuote.indexOf("'", 1);
						query = singleEnd > 0 ? afterQuote.slice(1, singleEnd) : afterQuote.slice(1).trim() || undefined;
					} else {
						query = afterQuote || undefined;
					}
				} else {
					// No end quote, treat whole thing as URL
					url = trimmed.slice(1);
				}
			} else if (trimmed.startsWith("'")) {
				const endQuote = trimmed.indexOf("'", 1);
				if (endQuote > 0) {
					url = trimmed.slice(1, endQuote);
					// Extract query after the closing quote, strip surrounding quotes if present
					const afterQuote = trimmed.slice(endQuote + 1).trim();
					if (afterQuote.startsWith("'") && afterQuote.endsWith("'")) {
						query = afterQuote.slice(1, -1).trim() || undefined;
					} else if (afterQuote.startsWith('"')) {
						const doubleEnd = afterQuote.indexOf('"', 1);
						query = doubleEnd > 0 ? afterQuote.slice(1, doubleEnd) : afterQuote.slice(1).trim() || undefined;
					} else {
						query = afterQuote || undefined;
					}
				} else {
					url = trimmed.slice(1);
				}
			} else {
				// Unquoted: first token is URL, rest is query
				const spaceIdx = trimmed.indexOf(' ');
				if (spaceIdx > 0) {
					url = trimmed.slice(0, spaceIdx);
					// Strip surrounding quotes from query if present
					const queryText = trimmed.slice(spaceIdx + 1).trim();
					if ((queryText.startsWith('"') && queryText.endsWith('"')) ||
						(queryText.startsWith("'") && queryText.endsWith("'"))) {
						query = queryText.slice(1, -1).trim() || undefined;
					} else {
						query = queryText || undefined;
					}
				} else {
					url = trimmed;
				}
			}

			// Validate URL
			try {
				new URL(url);
			} catch {
				ctx.ui.notify(`Invalid URL: ${url}`, 'error');
				return;
			}

			// Set custom working indicator and status for fetch progress
			ctx.ui.setWorkingIndicator({
				frames: ['🌐', '🌎', '🌍', '🌏', '🌗', '🌘'],
				intervalMs: 150,
			});
			ctx.ui.setStatus('webfetch', query ? '🔍 Starting research...' : '🌐 Starting fetch...');

			try {
				const result = await webfetchResearch(
					url,
					query,
					undefined,
					// Phase-based status updates using shared labels
					(status, phase) => {
						ctx.ui.setStatus('webfetch', phase ? getCommandPhaseLabel(phase, !!query) : status);
					},
				);
				const text = result.content[0]?.text || 'No content';

				// Add fetched content to context as a message without triggering a new turn
				pi.sendMessage({
					customType: 'webfetch-result',
					content: [{ type: 'text', text }],
					display: true,
					details: { ...result.details },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Fetch failed: ${message}`, 'error');
			} finally {
				// Reset working indicator to default and clear status
				ctx.ui.setWorkingIndicator();
				ctx.ui.setStatus('webfetch', undefined);
			}
		},
	});
}
