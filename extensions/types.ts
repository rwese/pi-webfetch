// Shared types for webfetch extension

import type { FetchPhase } from './helpers.js';

export interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	processedAs: 'markdown' | 'binary' | 'error' | 'spa' | 'fallback' | 'research';
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
	extracted?: boolean;
	browserWarning?: string;
	provider?: string;
	extractionMethod?: string;
	/** Current phase for streaming status display */
	phase?: FetchPhase;
	/** Whether this result was served from cache */
	cached?: boolean;
	/** Age of cached content in milliseconds */
	cacheAge?: number;
	/**
	 * Discovery hint from a provider (e.g. gh-cli advertising
	 * GitHub fetch options such as `includeComments` that the
	 * caller did not enable). Mirrors the in-content hint tail.
	 */
	githubHint?: string;
}

/**
 * GitHub-specific fetch options. Mirrors `GitHubFetchOptions` from
 * `src/providers/types.ts`; future options (e.g. `includeReviews`,
 * `maxCommentDepth`) are additive on this object.
 */
export interface GitHubFetchOptions {
	/** When true, include issue/PR conversation comments and PR review threads. */
	includeComments?: boolean;
}

export interface FetchResult {
	content: Array<{ type: 'text'; text: string }>;
	details: WebfetchDetails;
}

export interface ExtractResult {
	content: string;
	extracted: boolean;
}

export interface ProviderConfig {
	timeout?: number;
	waitFor?: 'networkidle' | 'domcontentloaded';
	forceProvider?: string;
	github?: GitHubFetchOptions;
}

export interface ProviderCapabilities {
	html: boolean;
	markdown: boolean;
	spa: boolean;
}

export interface URLDetection {
	type: 'github' | 'reddit' | 'binary' | 'spa' | 'unknown';
}

export interface ProviderFetchResult {
	content: string;
	contentType: string;
	status: number;
	extractionMethod?: string;
	providerName?: string;
	metadata?: Record<string, unknown>;
}

export interface WebfetchProvider {
	readonly name: string;
	readonly priority: number;
	readonly capabilities: ProviderCapabilities;
	isAvailable(): boolean;
	detectUrl(url: string): URLDetection;
	fetch(url: string, config?: ProviderConfig): Promise<ProviderFetchResult | null>;
}
