/**
 * Services
 *
 * Core service modules for webfetch functionality.
 */

// Session management
export {
	getProviderManager,
	closeAllProviders,
	closeAllSessionsProviders,
	getProviderStatus,
} from './session-manager.js';

// Fetch orchestration
export { fetchUrl, webfetchSPA, downloadFile } from './fetch-service.js';

// Research queries
export {
	webfetchResearch,
	type StatusCallback,
	type StreamingConfig,
	type ResearchNotify,
} from './research-service.js';

// Cache service
export {
	shouldSkipCache,
	cacheFetchResult,
	getCachedResult,
	buildCacheEntry,
	validateCacheEntry,
	extractHtmlTitle,
	type CacheFetchOptions,
} from './cache-service.js';

// Static fetch
export { staticFetch, handleBinary, __resetStaticOnlyWarningForTest } from './static-fetch.js';

// Header building
export {
	buildFetchHeader,
	wrapUntrustedContent,
	UNTRUSTED_CONTENT_BEGIN,
	UNTRUSTED_CONTENT_END,
} from './header-builder.js';
