// pi-webfetch extension - main entry point

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { WebfetchDetails } from './types.js';
import { Text } from '@mariozechner/pi-tui';
import { webfetchResultRenderer } from './message-renderers.js';
import { Type } from '@sinclair/typebox';

export type {
	WebfetchDetails,
	FetchResult,
	ExtractResult,
	ProviderConfig,
	ProviderCapabilities,
	URLDetection,
	ProviderFetchResult,
	WebfetchProvider,
} from './types.js';

// Fetch functions
import {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	fetchUrl, // Public API (used in README examples)
	webfetchSPA,
	downloadFile,
	getProviderStatus,
	webfetchResearch,
	closeAllSessionsProviders,
} from './fetch.js';

// HTML utilities
export { extractMainContent, convertToMarkdown } from './html.js';

// Markdown post-processing
export { removeMarkdownAnchors, extractEmbeddedImages, stripEmbeddedImages } from './markdown.js';

// Content type detection
export {
	isBrowserAvailable,
	isTextContentType,
	isBinaryContentType,
	getExtensionFromContentType,
} from './content-types.js';

// Helpers - includes phase labels and URL utilities
export {
	isLikelyBinaryUrl,
	convertGitHubToRaw,
	getTempFilePath,
	formatBytes,
	truncateToSize,
	parseUrlForDisplay,
} from './helpers.js';

// Phase labels for UI
import {
	parseUrlForDisplay,
	FETCH_PHASE_LABELS,
	getCommandPhaseLabel,
} from './helpers.js';

// Constants
export const MAX_MARKDOWN_SIZE = 100 * 1024;

// ============================================================================
// pi Extension Setup
// ============================================================================

export default function (pi: ExtensionAPI): void {
	// Register tools
	pi.registerTool({
		name: 'webfetch',
		label: 'Web Fetch',
		description: 'Fetch and process web pages from URLs, optionally with a research query',
		parameters: Type.Object({
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
		}),

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
				const textContent = result.content.find(c => c.type === 'text');
				if (textContent?.text) {
					const preview = textContent.text.split('\n').slice(0, 3).join('\n');
					content += '\n' + theme.fg('toolOutput', preview);
				}
			} else {
				// Show final result with actual content
				const url = details?.url || '';
				content += theme.fg('muted', parseUrlForDisplay(url));
				if (details?.provider) {
					content += ' ' + theme.fg('muted', `[${details.provider}]`);
				}

				// Include the actual fetched content in the result
				const textContent = result.content.find(c => c.type === 'text');
				if (textContent?.text) {
					content += '\n\n' + theme.fg('toolOutput', textContent.text);
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

	pi.registerTool({
		name: 'webfetch-spa',
		label: 'Web Fetch SPA',
		description: 'Fetch SPA/JS-heavy pages with browser rendering',
		parameters: Type.Object({
			url: Type.String({ description: 'The URL to fetch' }),
			waitFor: Type.Optional(
				Type.Union([Type.Literal('networkidle'), Type.Literal('domcontentloaded')], {
					description: 'Wait strategy',
				}),
			),
			timeout: Type.Optional(Type.Number({ description: 'Timeout in ms (default: 30000)' })),
		}),

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
			const text = new Text('', 0, 0);

			if (options.isPartial) {
				let content = theme.fg('toolTitle', theme.bold('🌐 webfetch-spa '));
				content += theme.fg('muted', '🌍 Loading SPA...');
				if (state.startedAt) {
					const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
					content += ' ' + theme.fg('muted', `(${elapsed}s)`);
				}
				text.setText(content);
			} else {
				let content = theme.fg('toolTitle', theme.bold('🌐 webfetch-spa '));
				const url = details?.url || '';
				content += theme.fg('muted', parseUrlForDisplay(url));
				if (details?.provider) {
					content += ' ' + theme.fg('muted', `[${details.provider}]`);
				}

				// Include the actual fetched content in the result
				const textContent = result.content.find(c => c.type === 'text');
				if (textContent?.text) {
					content += '\n\n' + theme.fg('toolOutput', textContent.text);
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

	pi.registerTool({
		name: 'download-file',
		label: 'Download File',
		description: 'Download a file from URL to temp location',
		parameters: Type.Object({
			url: Type.String({ description: 'The URL to download' }),
		}),
		async execute(_toolCallId, params, _signal) {
			const result = await downloadFile(params.url);
			return {
				content: [{ type: 'text', text: `File saved to: ${result.tempPath}` }],
				details: {
					url: params.url,
					tempPath: result.tempPath,
					contentType: result.contentType,
				},
			};
		},
	});

	pi.registerTool({
		name: 'webfetch-providers',
		label: 'Web Fetch Providers',
		description: 'Get status of available web fetch providers',
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal) {
			const providers = await getProviderStatus();
			const lines = [
				'## Web Fetch Providers',
				'',
				'| Provider | Available | Priority |',
				'|----------|-----------|----------|',
			];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Available' : '❌ Not installed';
				lines.push(`| ${p.name} | ${status} | ${p.priority} |`);
			}

			lines.push('');
			lines.push('### Installation');
			lines.push('```bash');
			lines.push('npm i -g agent-browser && agent-browser install  # Default provider');
			lines.push(
				'npm install -g clawfetch                         # Alternative with GitHub/Reddit fast-paths',
			);
			lines.push(
				'gh auth login                                    # GitHub CLI for issues/repos',
			);
			lines.push('```');

			return {
				content: [{ type: 'text', text: lines.join('\n') }],
				details: { providers },
			};
		},
	});

	// Register message renderer for webfetch results
	pi.registerMessageRenderer('webfetch-result', webfetchResultRenderer);

	// Register session shutdown handler to clean up browser resources
	pi.on('session_shutdown', async () => {
		await closeAllSessionsProviders();
	});

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

	// Status command: /webfetch:status - Show detailed provider status
	pi.registerCommand('webfetch:status', {
		description: 'Show webfetch provider status and details',
		handler: async (_args, ctx) => {
			const providers = await getProviderStatus();
			const available = providers.filter((p) => p.available);

			const lines = [
				'# 📡 webfetch Provider Status',
				'',
				'## Providers',
				'',
				'| Name | Status | Priority | Description |',
				'|------|--------|----------|-------------|',
			];

			const providerInfo: Record<string, { desc: string; features: string[] }> = {
				default: {
					desc: 'agent-browser',
					features: ['HTML rendering', 'SPA support', 'cheerio extraction'],
				},
				clawfetch: {
					desc: 'clawfetch CLI',
					features: [
						'Playwright',
						'Readability extraction',
						'GitHub fast-path',
						'Reddit RSS',
					],
				},
				'gh-cli': {
					desc: 'GitHub CLI',
					features: ['Structured data', 'Issues/PRs', 'Repos', 'Requires auth'],
				},
			};

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Available' : '❌ Missing';
				const info = providerInfo[p.name] || { desc: '-', features: [] };
				lines.push(`| **${p.name}** | ${status} | ${p.priority} | ${info.desc} |`);
			}

			lines.push('');
			lines.push('## Features by Provider');
			lines.push('');

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅' : '❌';
				const info = providerInfo[p.name] || { desc: '-', features: [] };
				lines.push(`### ${status} ${p.name} (${info.desc})`);
				lines.push('');
				for (const feature of info.features) {
					lines.push(`- ${feature}`);
				}
				lines.push('');
			}

			if (available.length === 0) {
				lines.push('## Installation', '', '```bash');
				lines.push('# agent-browser (default)');
				lines.push('npm i -g agent-browser && agent-browser install');
				lines.push('');
				lines.push('# clawfetch (GitHub/Reddit fast-paths)');
				lines.push('npm install -g clawfetch');
				lines.push('');
				lines.push('# gh CLI (GitHub issues/repos - must be authenticated)');
				lines.push('gh auth login');
				lines.push('```');
				lines.push('');
				lines.push('⚠️ No providers installed - HTML pages will use static fetch.');
			} else {
				lines.push(`✅ **${available.length} provider(s) ready**`);
				lines.push('');
				lines.push('## Quick Reference');
				lines.push('');
				lines.push('| Command | Description |');
				lines.push('|---------|-------------|');
				lines.push('| `/webfetch <url>` | Fetch URL with auto-provider selection |');
				lines.push('| `/webfetch:status` | Show provider status |');
				lines.push('| `/webfetch:info` | Show provider info |');
			}

			ctx.ui.notify(lines.join('\n'), 'info');
		},
	});

	// Register command
	pi.registerCommand('webfetch:info', {
		description: 'Show webfetch provider status and installation',
		handler: async (_args, ctx) => {
			const providers = await getProviderStatus();
			const available = providers.filter((p) => p.available);

			const lines = ['# 📡 webfetch Providers', '', '## Status', ''];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Installed' : '❌ Missing';
				const features: Record<string, string> = {
					default: 'agent-browser',
					clawfetch: 'clawfetch (GitHub/Reddit fast-paths)',
					'gh-cli': 'gh CLI (GitHub issues/repos)',
				};
				lines.push(`- **${p.name}** (${features[p.name] || '-'}): ${status}`);
			}

			if (available.length === 0) {
				lines.push(
					'',
					'## Installation',
					'',
					'```bash',
					'# agent-browser (default)',
					'npm i -g agent-browser && agent-browser install',
					'',
					'# clawfetch (GitHub/Reddit fast-paths)',
					'npm install -g clawfetch',
					'',
					'# gh CLI (GitHub issues/repos - must be authenticated)',
					'gh auth login',
					'```',
				);
				lines.push('', '⚠️ No providers installed - HTML pages will use static fetch.');
			} else {
				lines.push('', `✅ ${available.length} provider(s) ready`);
			}

			ctx.ui.notify(lines.join('\n'), 'info');
		},
	});
}
