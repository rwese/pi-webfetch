/**
 * Webfetch Tool Registration
 *
 * Registers the webfetch tool with the pi extension API.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { WebfetchDetails } from '../types.js';
import { Text } from '@mariozechner/pi-tui';
import { Type } from '@sinclair/typebox';
import { parseUrlForDisplay, FETCH_PHASE_LABELS } from '../helpers.js';
import { formatAge } from '../cache.js';
import { webfetchResearch } from '../fetch.js';

/**
 * Webfetch tool parameters schema
 */
export const WEBFETCH_TOOL_PARAMS = Type.Object({
	url: Type.String({ description: 'The URL to fetch' }),
	query: Type.Optional(
		Type.String({ description: 'Optional research question for AI analysis' }),
	),
	provider: Type.Optional(
		Type.Union(
			[Type.Literal('default'), Type.Literal('clawfetch'), Type.Literal('gh-cli')],
			{
				description: 'Force specific provider (gh-cli for GitHub issues/repos)',
			},
		),
	),
});

/**
 * Register the webfetch tool with the pi extension
 */
export function registerWebfetchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'webfetch',
		label: 'Web Fetch',
		description: 'Fetch and process web pages from URLs, optionally with a research query',
		parameters: WEBFETCH_TOOL_PARAMS,

		// Custom rendering for tool call display
		renderCall(args, theme, _context) {
			const text = new Text('', 0, 0);
			let content = theme.fg('toolTitle', theme.bold('🌐 webfetch '));
			content += theme.fg('muted', parseUrlForDisplay(args.url));
			if (args.query) {
				content += ' ' + theme.fg('accent', `"${args.query.slice(0, 50)}${args.query.length > 50 ? '...' : ''}"`);
			}
			text.setText(content);
			return text;
		},

		// Custom rendering for tool result display
		renderResult(result, options, theme, context) {
			const state = context.state as {
				startedAt?: number;
				interval?: ReturnType<typeof setInterval>;
				lastStatus?: string;
			};

			// Track elapsed time during partial results
			if (state.startedAt && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), 500);
			}

			// Stop timer on completion
			if (!options.isPartial || context.isError) {
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}

			const details = result.details as WebfetchDetails | undefined;
			const phase = details?.phase || 'idle';
			const textContent = result.content.find(c => c.type === 'text');
			const textValue = textContent?.text || '';
			const lines = textValue.split('\n');

			// Build status display
			const text = new Text('', 0, 0);
			let content = theme.fg('toolTitle', theme.bold('🌐 webfetch '));

			if (options.isPartial) {
				// Show phase indicator using shared labels
				content += theme.fg('muted', FETCH_PHASE_LABELS[phase]);

				// Show elapsed time
				if (state.startedAt) {
					const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
					content += ' ' + theme.fg('muted', `(${elapsed}s)`);
				}

				// Show preview of output (only text content)
				if (lines.length > 0) {
					const preview = lines.slice(0, 3).join('\n');
					content += '\n' + theme.fg('toolOutput', preview);
				}
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
			}

			text.setText(content);
			return text;
		},

		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			// Phase 1: Starting - send initial update
			onUpdate?.({
				content: [{ type: 'text', text: '' }],
				details: { phase: 'starting', url: params.url },
			});
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Phase 2: Fetch with detailed status updates
			const result = await webfetchResearch(
				params.url,
				params.query,
				undefined,
				// Status callback for non-streaming mode
				(status, phase) => {
					onUpdate?.({
						content: [{ type: 'text', text: status }],
						details: { phase: phase || 'fetching', url: params.url },
					});
				},
				// OnUpdate callback for streaming mode
				{
					callback: onUpdate,
					url: params.url,
					initialPhase: params.query ? 'analyzing' : 'processing',
					streamingPhase: 'streaming',
				},
			);

			return result;
		},
	});
}
