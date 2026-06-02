// pi-webfetch extension - main entry point

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

// Types
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

// Tools - only webfetch and webfetch-clear-cache
import {
	registerWebfetchTool,
	registerWebfetchClearCacheTool,
} from './tools/index.js';

// Commands
import {
	registerWebfetchCommand,
	registerWebfetchStatusCommand,
	registerWebfetchInfoCommand,
	registerWebfetchCacheCommand,
	registerWebfetchProvidersCommand,
} from './commands/index.js';

// Fetch functions
import { closeAllSessionsProviders } from './fetch.js';

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

// Cache utilities
export {
	getCache,
	clearCache,
	clearAllCache,
	getCacheStats,
	formatAge,
} from './cache.js';

// Constants
export const MAX_MARKDOWN_SIZE = 100 * 1024;

// ============================================================================
// pi Extension Setup
// ============================================================================

export default function (pi: ExtensionAPI): void {
	// Register tools (MCP-style, only essential ones)
	registerWebfetchTool(pi);
	registerWebfetchClearCacheTool(pi);

	// Register commands (additional functionality via /command)
	registerWebfetchCommand(pi);
	registerWebfetchStatusCommand(pi);
	registerWebfetchInfoCommand(pi);
	registerWebfetchCacheCommand(pi);
	registerWebfetchProvidersCommand(pi);

	// Register session shutdown handler to clean up browser resources
	pi.on('session_shutdown', async () => {
		await closeAllSessionsProviders();
	});
}