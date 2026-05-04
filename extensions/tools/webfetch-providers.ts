/**
 * Webfetch Providers Tool Registration
 *
 * Registers the webfetch-providers tool for checking provider status.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { getProviderStatus } from '../fetch.js';

/**
 * Webfetch providers tool parameters schema (empty)
 */
export const WEBFETCH_PROVIDERS_TOOL_PARAMS = Type.Object({});

/**
 * Register the webfetch-providers tool with the pi extension
 */
export function registerWebfetchProvidersTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'webfetch-providers',
		label: 'Web Fetch Providers',
		description: 'Get status of available web fetch providers',
		parameters: WEBFETCH_PROVIDERS_TOOL_PARAMS,
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
}
