// pi-webfetch extension - main entry point

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
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
	fetchUrl,
	webfetchSPA,
	downloadFile,
	getProviderStatus,
	webfetchResearch,
} from './fetch.js';
export { fetchUrl, webfetchSPA, downloadFile, getProviderStatus, webfetchResearch };

// HTML utilities
export { extractMainContent, detectLikelySPA, convertToMarkdown } from './html.js';

// Markdown post-processing
export { removeMarkdownAnchors, extractEmbeddedImages, stripEmbeddedImages } from './markdown.js';

// Content type detection
export {
	isBrowserAvailable,
	isTextContentType,
	isBinaryContentType,
	getExtensionFromContentType,
} from './content-types.js';

// Helpers
export {
	isLikelyBinaryUrl,
	convertGitHubToRaw,
	getTempFilePath,
	formatBytes,
	truncateToSize,
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
		async execute(_toolCallId, params, _signal) {
			const result = await webfetchResearch(params.url, params.query);
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
		async execute(_toolCallId, params, _signal) {
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
					query = trimmed.slice(endQuote + 1).trim() || undefined;
				} else {
					// No end quote, treat whole thing as URL
					url = trimmed.slice(1);
				}
			} else if (trimmed.startsWith("'")) {
				const endQuote = trimmed.indexOf("'", 1);
				if (endQuote > 0) {
					url = trimmed.slice(1, endQuote);
					query = trimmed.slice(endQuote + 1).trim() || undefined;
				} else {
					url = trimmed.slice(1);
				}
			} else {
				// Unquoted: first token is URL, rest is query
				const spaceIdx = trimmed.indexOf(' ');
				if (spaceIdx > 0) {
					url = trimmed.slice(0, spaceIdx);
					query = trimmed.slice(spaceIdx + 1).trim() || undefined;
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

			const statusMsg = query ? 'Researching...' : 'Fetching...';
			ctx.ui.setStatus('webfetch', statusMsg);

			try {
				const result = await webfetchResearch(url, query);
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
