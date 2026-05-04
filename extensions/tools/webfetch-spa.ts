/**
 * Webfetch SPA Tool Registration
 *
 * Registers the webfetch-spa tool for browser-rendered page fetching.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { WebfetchDetails } from '../types.js';
import { Text } from '@mariozechner/pi-tui';
import { Type } from '@sinclair/typebox';
import { parseUrlForDisplay } from '../helpers.js';
import { formatAge } from '../cache.js';
import { webfetchSPA } from '../fetch.js';

/**
 * Webfetch SPA tool parameters schema
 */
export const WEBFETCH_SPA_TOOL_PARAMS = Type.Object({
	url: Type.String({ description: 'The URL to fetch' }),
	waitFor: Type.Optional(
		Type.Union([Type.Literal('networkidle'), Type.Literal('domcontentloaded')], {
			description: 'Wait strategy',
		}),
	),
	timeout: Type.Optional(Type.Number({ description: 'Timeout in ms (default: 30000)' })),
});

/**
 * Register the webfetch-spa tool with the pi extension
 */
export function registerWebfetchSpaTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'webfetch-spa',
		label: 'Web Fetch SPA',
		description: 'Fetch SPA/JS-heavy pages with browser rendering',
		parameters: WEBFETCH_SPA_TOOL_PARAMS,

		// Custom rendering for tool call display
		renderCall(args, theme, _context) {
			const text = new Text('', 0, 0);
			let content = theme.fg('toolTitle', theme.bold('🌐 webfetch-spa '));
			content += theme.fg('muted', parseUrlForDisplay(args.url));
			if (args.waitFor) {
				content += ' ' + theme.fg('muted', `(wait: ${args.waitFor})`);
			}
			text.setText(content);
			return text;
		},

		// Custom rendering for tool result display
		renderResult(result, options, theme, context) {
			const state = context.state as {
				startedAt?: number;
				interval?: ReturnType<typeof setInterval>;
			};

			// Track elapsed time during partial results
			if (state.startedAt && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 500);
			}

			if (!options.isPartial || context.isError) {
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}

			const details = result.details as WebfetchDetails | undefined;
			const textContent = result.content.find(c => c.type === 'text');
			const textValue = textContent?.text || '';
			const lines = textValue.split('\n');
			const text = new Text('', 0, 0);
			let content = theme.fg('toolTitle', theme.bold('🌐 webfetch-spa '));

			if (options.isPartial) {
				content += theme.fg('muted', '🌍 Loading SPA...');
				if (state.startedAt) {
					const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
					content += ' ' + theme.fg('muted', `(${elapsed}s)`);
				}
				text.setText(content);
			} else if (!options.expanded) {
				// Collapsed view: show summary
				const url = details?.url || '';
				const lineCount = lines.length;
				const preview = lines[0]?.slice(0, 60) ?? '';

				content += theme.fg('muted', parseUrlForDisplay(url));
				if (details?.provider) {
					content += ' ' + theme.fg('muted', `[${details.provider}]`);
				}
				content += '\n' + theme.fg('muted', `→ ${lineCount} lines`);
				if (preview) {
					content += ' ' + theme.fg('muted', `"${preview}${preview.length >= 60 ? '...' : ''}"`);
				}
			} else {
				// Expanded view: show full content
				const url = details?.url || '';
				content += theme.fg('muted', parseUrlForDisplay(url));
				if (details?.provider) {
					content += ' ' + theme.fg('muted', `[${details.provider}]`);
				}
				if (details?.cached && details?.cacheAge !== undefined) {
					content += ' ' + theme.fg('muted', `[cached ${formatAge(details.cacheAge)}]`);
				}

				if (textValue) {
					content += '\n\n' + theme.fg('toolOutput', textValue);
				}
				text.setText(content);
			}

			return text;
		},

		async execute(_toolCallId, params, _signal, onUpdate) {
			// Initial update
			onUpdate?.({
				content: [{ type: 'text', text: '' }],
				details: { phase: 'fetching', url: params.url },
			});
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Processing update
			onUpdate?.({
				content: [{ type: 'text', text: '🌍 Loading SPA...' }],
				details: { phase: 'processing', url: params.url },
			});

			return await webfetchSPA(
				params.url,
				params.waitFor ?? 'networkidle',
				params.timeout ?? 30000,
			);
		},
	});
}
