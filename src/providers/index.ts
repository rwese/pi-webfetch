/**
 * Webfetch Providers
 *
 * Provider abstraction for content extraction.
 * Supports multiple backends (agent-browser, clawfetch) with auto-detection.
 */

// Types
export {
	type FetchMetadata,
	type ProviderFetchResult,
	type ProviderCapabilities,
	type URLDetection,
	type ProviderConfig,
	type FetchConfig,
	type NoProviderResult,
	type WebfetchResult,
	ProviderError,
} from './types.js';

// Providers
export { DefaultProvider } from './default.js';
export { ClawfetchProvider } from './clawfetch.js';
export { GhCliProvider } from './gh-cli.js';

// Manager
export { ProviderManager, createProviderManager, type ProviderManagerConfig } from './manager.js';
