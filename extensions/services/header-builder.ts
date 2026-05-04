/**
 * Header Builder Service
 *
 * Builds metadata headers for fetch results.
 */

import type { WebfetchDetails } from '../types.js';
import { formatBytes } from '../utils/formatting.js';

const MAX_MARKDOWN_SIZE = 100 * 1024;

/**
 * Build the fetch result header with metadata
 */
export function buildFetchHeader(details: WebfetchDetails): string {
	const lines = [
		`## Fetch Result\n`,
		`**URL:** ${details.url}\n`,
		`**Status:** ${details.status}`,
	];

	if (details.contentType) lines.push(`**Content-Type:** ${details.contentType}`);

	const processed = details.processedAs || 'unknown';
	lines.push(`**Processed as:** ${processed}`);

	if (details.originalSize) lines.push(`**Original size:** ${formatBytes(details.originalSize)}`);
	if (details.tempFileSize) lines.push(`**Output size:** ${formatBytes(details.tempFileSize)}`);
	if (details.provider) lines.push(`**Provider:** ${details.provider}`);
	if (details.extractionMethod) lines.push(`**Method:** ${details.extractionMethod}`);
	if (details.browserWarning) lines.push(`\n> ⚠️ ${details.browserWarning}`);
	if (details.truncated)
		lines.push(`\n> ⚠️ Content truncated to ${formatBytes(MAX_MARKDOWN_SIZE)}`);

	return lines.join('\n') + '\n\n<!-- -->\n\n';
}
