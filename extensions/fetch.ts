/**
 * Fetch functions for webfetch extension
 *
 * This file re-exports from specialized service modules for backward compatibility.
 * New code should import directly from the specific modules.
 */

// Re-export FetchPhase for external use
export type { FetchPhase } from './fetch-phases.js';

// Re-export all services
export {
	// Session management
	getProviderManager,
	closeAllProviders,
	closeAllSessionsProviders,
	getProviderStatus,

	// Fetch orchestration
	fetchUrl,
	webfetchSPA,
	downloadFile,

	// Research queries
	webfetchResearch,
	type StatusCallback,
	type StreamingConfig,

	// Cache service
	shouldSkipCache,
	cacheFetchResult,
	getCachedResult,
	buildCacheEntry,

	// Static fetch
	staticFetch,
	handleBinary,

	// Header building
	buildFetchHeader,
} from './services/index.js';
