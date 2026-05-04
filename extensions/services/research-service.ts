/**
 * Research Service
 *
 * Handles research queries that spawn pi sub-agents for content analysis.
 */

import type { WebfetchDetails, FetchResult } from '../types.js';
import type { AgentToolUpdateCallback } from '@mariozechner/pi-coding-agent';
import { spawnPiAgent, type SpawnPiAgentResult } from '../pi-agent.js';
import type { FetchPhase } from '../fetch-phases.js';
import { fetchUrl } from './fetch-service.js';

/** Result type for research queries */
export interface ResearchResult {
	/** The analysis text from the sub-agent */
	analysis: string;
	/** The original fetch result details */
	details: WebfetchDetails;
}

/** Status callback for long-running operations */
export type StatusCallback = (status: string, phase?: FetchPhase) => void;

/** OnUpdate callback type alias for clarity */
type OnUpdateCallback = AgentToolUpdateCallback<Record<string, unknown>>;

/** Streaming callback configuration for webfetch */
export interface StreamingConfig {
	/** The main onUpdate callback from the tool */
	callback: OnUpdateCallback | undefined;
	/** The URL being fetched */
	url: string;
	/** Phase to show during initial processing */
	initialPhase: FetchPhase;
	/** Phase to show during streaming */
	streamingPhase: FetchPhase;
	/** Whether to show header */
	showHeader?: boolean;
}

/**
 * Send a partial update through the streaming callback
 */
function sendStreamingUpdate(config: StreamingConfig, content: string, phase: FetchPhase): void {
	config.callback?.({
		content: [{ type: 'text', text: content }],
		details: { phase, url: config.url },
	});
}

/**
 * Yield to event loop to allow UI updates to be processed
 */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fetch a URL and analyze its content based on a research query
 *
 * @param url - The URL to fetch
 * @param query - Optional research question/analysis request
 * @param fetchFn - Optional fetch function (defaults to global fetch)
 * @param onStatus - Optional status callback for non-streaming updates
 * @param streamingConfig - Optional streaming configuration for real-time updates
 * @returns FetchResult with analysis or error content
 *
 * @example
 * ```typescript
 * // With query - returns AI analysis
 * const result = await webfetchResearch('https://example.com', 'Summarize this page');
 *
 * // Without query - falls back to regular fetch
 * const result = await webfetchResearch('https://example.com');
 * ```
 */
export async function webfetchResearch(
	url: string,
	query?: string,
	fetchFn?: typeof fetch,
	onStatus?: StatusCallback,
	streamingConfig?: StreamingConfig | OnUpdateCallback,
): Promise<FetchResult> {
	// Use provided fetch or default
	const fetchFunc = fetchFn || fetch;

	// Normalize streaming config - handle both StreamingConfig and legacy OnUpdateCallback
	let config: StreamingConfig | undefined;
	if (streamingConfig) {
		if ('callback' in streamingConfig) {
			config = streamingConfig;
		} else {
			// Legacy OnUpdateCallback - wrap it
			config = {
				callback: streamingConfig,
				url,
				initialPhase: 'processing',
				streamingPhase: 'streaming',
			};
		}
	}

	// Phase 1: Detect provider
	if (config) {
		sendStreamingUpdate(config, '🔍 Detecting provider...', 'detecting-provider');
	} else {
		onStatus?.('Detecting provider...', 'detecting-provider');
	}
	await yieldToEventLoop();

	// Phase 2: Fetch URL content
	if (config) {
		sendStreamingUpdate(config, '🌐 Fetching...', 'fetching');
	} else {
		onStatus?.('Fetching...', 'fetching');
	}
	const fetchResult = await fetchUrl(url, fetchFunc);

	// If no query provided, return regular fetch result
	if (!query) {
		// Show processing phase
		if (config) {
			sendStreamingUpdate(config, '⚙️ Processing content...', 'processing');
		} else {
			onStatus?.('Processing...', 'processing');
		}
		await yieldToEventLoop();
		return fetchResult;
	}

	// Extract content from fetch result
	const content = fetchResult.content[0]?.text || '';

	// Check if we have actual content to analyze
	if (!content || content.includes('Error:')) {
		return fetchResult;
	}

	try {
		// Phase 3: Analyze content
		if (config) {
			sendStreamingUpdate(config, '🧠 Analyzing content...', 'analyzing');
		} else {
			onStatus?.('Analyzing...', 'analyzing');
		}
		await yieldToEventLoop();

		// Build header
		const header = [
			`## Research Result\n`,
			`**Command:** /webfetch ${url} "${query}"\n`,
			`\n---\n`,
		].join('');

		// If we have streaming config, stream results directly to it
		if (config) {
			// Send initial header as first update
			sendStreamingUpdate(config, header + '📝 Generating response...', config.initialPhase);
			await yieldToEventLoop();

			// Stream chunks from pi agent directly to onUpdate
			const agentResult: SpawnPiAgentResult = await spawnPiAgent(content, query, {
				onChunk: (chunk) => {
					config.callback?.({
						content: [{ type: 'text', text: chunk }],
						details: { phase: config.streamingPhase, url, streamed: true },
					});
				},
			});

			const researchDetails: WebfetchDetails = {
				...fetchResult.details,
				processedAs: 'research',
				phase: 'complete',
			};

			// Return with final analysis (chunks already streamed)
			return {
				content: [{ type: 'text', text: header + agentResult.analysis }],
				details: researchDetails,
			};
		}

		// No streaming available, use regular behavior
		const agentResult: SpawnPiAgentResult = await spawnPiAgent(content, query);

		const researchDetails: WebfetchDetails = {
			...fetchResult.details,
			processedAs: 'research',
		};

		return {
			content: [{ type: 'text', text: header + agentResult.analysis }],
			details: researchDetails,
		};
	} catch (error) {
		// On agent error, fall back to showing the fetched content
		const errorMessage = error instanceof Error ? error.message : String(error);
		const fallbackHeader = [
			`## Fetch Result (Agent Error)\n`,
			`**Command:** /webfetch ${url} "${query}"\n`,
			`**Agent Error:** ${errorMessage}\n`,
			`\n---\n`,
		].join('');

		return {
			content: [{ type: 'text', text: fallbackHeader + content }],
			details: { ...fetchResult.details, processedAs: 'error', phase: 'error' },
		};
	}
}
