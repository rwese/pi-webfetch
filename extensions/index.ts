// pi-webfetch extension - main entry point
// Re-exports all public APIs

export type { WebfetchDetails, FetchResult, ExtractResult, ProviderConfig, ProviderCapabilities, URLDetection, ProviderFetchResult, WebfetchProvider } from './types.js';

// Fetch functions
export { fetchUrl, webfetch, webfetchSPA, downloadFile, getProviderStatus } from './fetch.js';

// HTML utilities
export { extractMainContent, detectLikelySPA, convertToMarkdown } from './html.js';

// Markdown post-processing
export { removeMarkdownAnchors, extractEmbeddedImages, stripEmbeddedImages } from './markdown.js';

// Content type detection
export { isBrowserAvailable, isTextContentType, isBinaryContentType, getExtensionFromContentType } from './content-types.js';

// Helpers
export { isLikelyBinaryUrl, convertGitHubToRaw, getTempFilePath, formatBytes, truncateToSize } from './helpers.js';

// Constants
export const MAX_MARKDOWN_SIZE = 100 * 1024;
