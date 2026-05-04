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
