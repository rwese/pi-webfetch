/**
 * Webfetch Status Command Handler
 *
 * Handles the /webfetch:status command for showing provider status.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { getProviderStatus } from '../fetch.js';

/**
 * Provider info for display
 */
const PROVIDER_INFO: Record<string, { desc: string; features: string[] }> = {
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

/**
 * Register the webfetch:status command handler
 */
export function registerWebfetchStatusCommand(pi: ExtensionAPI): void {
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

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Available' : '❌ Missing';
				const info = PROVIDER_INFO[p.name] || { desc: '-', features: [] };
				lines.push(`| **${p.name}** | ${status} | ${p.priority} | ${info.desc} |`);
			}

			lines.push('');
			lines.push('## Features by Provider');
			lines.push('');

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅' : '❌';
				const info = PROVIDER_INFO[p.name] || { desc: '-', features: [] };
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
}
