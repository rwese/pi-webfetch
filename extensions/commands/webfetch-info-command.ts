/**
 * Webfetch Info Command Handler
 *
 * Handles the /webfetch:info command for showing provider information.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { getProviderStatus } from '../fetch.js';

/**
 * Provider features display mapping
 */
const PROVIDER_FEATURES: Record<string, string> = {
	default: 'agent-browser',
	clawfetch: 'clawfetch (GitHub/Reddit fast-paths)',
	'gh-cli': 'gh CLI (GitHub issues/repos)',
};

/**
 * Register the webfetch:info command handler
 */
export function registerWebfetchInfoCommand(pi: ExtensionAPI): void {
	pi.registerCommand('webfetch:info', {
		description: 'Show webfetch provider status and installation',
		handler: async (_args, ctx) => {
			const providers = await getProviderStatus();
			const available = providers.filter((p) => p.available);

			const lines = ['# 📡 webfetch Providers', '', '## Status', ''];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Installed' : '❌ Missing';
				const features = PROVIDER_FEATURES[p.name] || '-';
				lines.push(`- **${p.name}** (${features}): ${status}`);
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
