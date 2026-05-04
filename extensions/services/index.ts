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
export { webfetchResearch, type StatusCallback, type StreamingConfig } from './research-service.js';

// Cache service
export {
	shouldSkipCache,
	cacheFetchResult,
	getCachedResult,
	buildCacheEntry,
} from './cache-service.js';

// Static fetch
export { staticFetch, handleBinary } from './static-fetch.js';

// Header building
export { buildFetchHeader } from './header-builder.js';
