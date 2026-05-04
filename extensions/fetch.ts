// Fetch functions for webfetch extension

import type { WebfetchDetails, FetchResult, ProviderConfig, ProviderFetchResult } from './types.js';
import type { AgentToolUpdateCallback } from '@mariozechner/pi-coding-agent';
import { spawnPiAgent, type SpawnPiAgentResult } from './pi-agent.js';
import {
	convertGitHubToRaw,
	isLikelyBinaryUrl,
	getTempFilePath,
	formatBytes,
	truncateToSize,
} from './helpers.js';
import type { FetchPhase } from './helpers.js';
// Re-export FetchPhase for external use
export type { FetchPhase } from './helpers.js';
import { isBinaryContentType, getExtensionFromContentType } from './content-types.js';
import { extractMainContent, convertToMarkdown } from './html.js';
import { removeMarkdownAnchors, extractEmbeddedImages } from './markdown.js';
import { getCache, setCache, formatAge } from './cache.js';

const MAX_MARKDOWN_SIZE = 100 * 1024;

/**
 * Check if we should skip caching for a URL
 * Currently skips raw GitHub URLs as they are typically versioned content
 */
function shouldSkipCache(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname.toLowerCase() === 'raw.githubusercontent.com';
	} catch {
		return false;
	}
}

/**
 * Session-scoped provider managers
 * Each pi session gets its own provider manager with fresh browser state
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionProviders = new Map<symbol, any>();

/**
 * Get the provider manager for the current session
 * Creates a new one if not exists (session-scoped browser state)
 */
export async function getProviderManager(): Promise<any> {
	const key = Symbol('session');

	if (!sessionProviders.has(key)) {
		const module = await import('../src/providers/manager.js');
		sessionProviders.set(key, new module.ProviderManager());
	}
	return sessionProviders.get(key);
}

/** Close all providers for a specific session */
export async function closeAllProviders(sessionId?: symbol): Promise<void> {
	const key = sessionId ?? Symbol('default');
	const manager = sessionProviders.get(key);
	if (manager) {
		await manager.closeAll();
		sessionProviders.delete(key);
	}
}

/** Close all providers across all sessions */
export async function closeAllSessionsProviders(): Promise<void> {
	await Promise.all(
		Array.from(sessionProviders.keys()).map((key) => closeAllProviders(key as symbol))
	);
}

/** Build the fetch result header with metadata */
function buildFetchHeader(details: WebfetchDetails): string {
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

// ============================================================================
// Main fetch functions
// ============================================================================

/** Helper to cache a successful fetch result */
async function cacheFetchResult(result: FetchResult): Promise<FetchResult> {
	const url = result.details.url;
	if (shouldSkipCache(url)) return result;
	
	const textContent = result.content[0]?.text;
	if (!textContent) return result;
	
	try {
		await setCache(url, {
			url,
			content: textContent,
			contentType: result.details.contentType,
			status: result.details.status,
			provider: result.details.provider,
			extractionMethod: result.details.extractionMethod,
			cachedAt: Date.now(),
		});
	} catch {
		// Cache write failure is non-fatal
	}
	
	return result;
}

/** Main webfetch function - auto-detects best fetch method */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	provider?: string,
): Promise<FetchResult> {
	// Check cache first (unless we should skip caching)
	if (!shouldSkipCache(url)) {
		const cached = await getCache(url);
		if (cached) {
			const cacheAge = Date.now() - cached.cachedAt;
			const details: WebfetchDetails = {
				url,
				contentType: cached.contentType,
				status: cached.status,
				processedAs: 'fallback',
				provider: cached.provider,
				extractionMethod: cached.extractionMethod,
				cached: true,
				cacheAge,
			};
			// Append cache footer to content
			const cacheFooter = `\n\n---\n\n> 💾 *Cached result from ${formatAge(cacheAge)}*`;
			return {
				content: [{ type: 'text' as const, text: cached.content + cacheFooter }],
				details,
			};
		}
	}

	// Check if URL is likely binary
	if (isLikelyBinaryUrl(url)) {
		return cacheFetchResult(await handleBinary(url, fetchFn));
	}

	// Check for provider-based fetch (default for HTML content)
	const manager = await getProviderManager();
	const hostname = new URL(url).hostname.toLowerCase();
	const isRawGitHubUrl = hostname === 'raw.githubusercontent.com';

	// Use provider by default for HTML content; static fetch only for:
	// - Raw GitHub URLs (machine-readable format)
	// - When explicitly requested via provider: "none"
	const shouldUseProvider = !isRawGitHubUrl && provider !== 'none';

	if (shouldUseProvider) {
		try {
			const config: ProviderConfig = { forceProvider: provider || undefined };
			const providerResult = await manager.fetch(url, config);

			if (providerResult && 'content' in providerResult) {
				const result = providerResult as ProviderFetchResult;
				const originalSize = Buffer.byteLength(result.content, 'utf-8');
				let cleanedContent = removeMarkdownAnchors(result.content);

				// Extract embedded images to temp file
				const imageResult = await extractEmbeddedImages(cleanedContent);
				cleanedContent = imageResult.content;

				const truncated = originalSize > MAX_MARKDOWN_SIZE;
				let content = truncateToSize(cleanedContent, MAX_MARKDOWN_SIZE);
				if (imageResult.tempFilePath) {
					content += `\n\n> 📎 **Embedded images** extracted to: ${imageResult.tempFilePath}`;
				}

				const details: WebfetchDetails = {
					url,
					contentType: result.contentType,
					status: result.status,
					processedAs: 'spa',
					originalSize,
					tempFileSize: Buffer.byteLength(content, 'utf-8'),
					truncated,
					extracted: true,
					provider: result.providerName,
					extractionMethod: result.extractionMethod,
				};

				const fetchResult: FetchResult = {
					content: [{ type: 'text' as const, text: buildFetchHeader(details) + content }],
					details,
				};
				return cacheFetchResult(fetchResult);
			}
		} catch {
			// Provider failed, fall back to static fetch
		}
	}

	// Fallback to static fetch
	return cacheFetchResult(await staticFetch(url, fetchFn));
}

/** Static HTML fetch with content extraction */
async function staticFetch(url: string, fetchFn: typeof fetch): Promise<FetchResult> {
	const originalUrl = url;
	const { rawUrl, isGitHubRaw } = convertGitHubToRaw(url);

	try {
		const response = await fetchFn(rawUrl);
		const status = response.status;
		const contentType = response.headers.get('content-type');

		// Binary content
		if (isBinaryContentType(contentType)) {
			const extension = getExtensionFromContentType(contentType, url);
			const tempPath = getTempFilePath('webfetch-binary', extension);
			const buffer = Buffer.from(await response.arrayBuffer());
			const fs = await import('node:fs');
			fs.writeFileSync(tempPath, buffer);

			const details: WebfetchDetails = {
				url: originalUrl,
				contentType,
				status,
				processedAs: 'binary',
				tempFileSize: buffer.length,
			};

			return {
				content: [{ type: 'text', text: `Binary file saved to: ${tempPath}` }],
				details,
			};
		}

		// Text/markdown content (GitHub raw files)
		if (
			isGitHubRaw ||
			contentType?.includes('text/plain') ||
			contentType?.includes('text/markdown')
		) {
			const text = await response.text();
			const originalSize = Buffer.byteLength(text, 'utf-8');
			const truncated = originalSize > MAX_MARKDOWN_SIZE;
			const finalText = truncateToSize(text, MAX_MARKDOWN_SIZE);

			const details: WebfetchDetails = {
				url: originalUrl,
				contentType,
				status,
				processedAs: 'markdown',
				originalSize,
				tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
				truncated,
			};

			return {
				content: [{ type: 'text', text: buildFetchHeader(details) + finalText }],
				details,
			};
		}

		// HTML content
		if (contentType?.includes('text/html')) {
			const html = await response.text();
			const originalSize = Buffer.byteLength(html, 'utf-8');
			const { content: extractedHtml, extracted } = extractMainContent(html);
			let markdown = convertToMarkdown(extractedHtml);

			// Apply post-processing
			markdown = removeMarkdownAnchors(markdown);
			const imageResult = await extractEmbeddedImages(markdown);
			markdown = imageResult.content;
			if (imageResult.tempFilePath) {
				markdown += `\n\n> 📎 **Embedded images** extracted to: ${imageResult.tempFilePath}`;
			}

			const truncated = Buffer.byteLength(markdown, 'utf-8') > MAX_MARKDOWN_SIZE;
			markdown = truncateToSize(markdown, MAX_MARKDOWN_SIZE);

			const details: WebfetchDetails = {
				url: originalUrl,
				contentType,
				status,
				processedAs: 'fallback',
				originalSize,
				tempFileSize: Buffer.byteLength(markdown, 'utf-8'),
				truncated,
				extracted,
				browserWarning: 'Using static fetch (no browser provider available)',
			};

			return {
				content: [{ type: 'text', text: buildFetchHeader(details) + markdown }],
				details,
			};
		}

		// Unknown content type
		const text = await response.text();
		const details: WebfetchDetails = {
			url: originalUrl,
			contentType,
			status,
			processedAs: 'error',
		};

		return {
			content: [{ type: 'text', text: buildFetchHeader(details) + text }],
			details,
		};
	} catch (error) {
		const details: WebfetchDetails = {
			url: originalUrl,
			contentType: null,
			status: 0,
			processedAs: 'error',
		};

		return {
			content: [{ type: 'text', text: buildFetchHeader(details) + `Error: ${error}` }],
			details,
		};
	}
}

/** Handle binary content */
async function handleBinary(url: string, fetchFn: typeof fetch): Promise<FetchResult> {
	try {
		const response = await fetchFn(url);
		const contentType = response.headers.get('content-type') || 'application/octet-stream';
		const extension = getExtensionFromContentType(contentType, url);
		const tempPath = getTempFilePath('webfetch-binary', extension);
		const buffer = Buffer.from(await response.arrayBuffer());

		const fs = await import('node:fs');
		fs.writeFileSync(tempPath, buffer);

		const details: WebfetchDetails = {
			url,
			contentType,
			status: response.status,
			processedAs: 'binary',
			tempFileSize: buffer.length,
		};

		return {
			content: [{ type: 'text', text: `Binary file saved to: ${tempPath}` }],
			details,
		};
	} catch (error) {
		const details: WebfetchDetails = {
			url,
			contentType: null,
			status: 0,
			processedAs: 'error',
		};
		return { content: [{ type: 'text', text: `Error downloading binary: ${error}` }], details };
	}
}

// ============================================================================
// Convenience functions
// ============================================================================

/** Explicit browser-based fetch for SPAs */
export async function webfetchSPA(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000,
): Promise<FetchResult> {
	// Check cache first
	if (!shouldSkipCache(url)) {
		const cached = await getCache(url);
		if (cached) {
			const cacheAge = Date.now() - cached.cachedAt;
			const details: WebfetchDetails = {
				url,
				contentType: cached.contentType,
				status: cached.status,
				processedAs: 'spa',
				provider: cached.provider,
				extractionMethod: cached.extractionMethod,
				cached: true,
				cacheAge,
			};
			// Append cache footer to content
			const cacheFooter = `\n\n---\n\n> 💾 *Cached result from ${formatAge(cacheAge)}*`;
			return {
				content: [{ type: 'text' as const, text: cached.content + cacheFooter }],
				details,
			};
		}
	}

	const manager = await getProviderManager();
	const config: ProviderConfig = {
		timeout,
		waitFor: waitFor as 'networkidle' | 'domcontentloaded',
	};
	const result = await manager.fetch(url, config);

	if (result && 'content' in result) {
		const providerResult = result as ProviderFetchResult;
		let cleanedText = removeMarkdownAnchors(providerResult.content);

		// Extract embedded images
		const imageResult = await extractEmbeddedImages(cleanedText);
		cleanedText = imageResult.content;

		const originalSize = Buffer.byteLength(providerResult.content, 'utf-8');
		const truncated = originalSize > MAX_MARKDOWN_SIZE;
		let finalText = truncateToSize(cleanedText, MAX_MARKDOWN_SIZE);
		if (imageResult.tempFilePath) {
			finalText += `\n\n> 📎 **Embedded images** extracted to: ${imageResult.tempFilePath}`;
		}

		const details: WebfetchDetails = {
			url,
			contentType: providerResult.contentType,
			status: providerResult.status,
			processedAs: 'spa',
			originalSize,
			tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
			truncated,
			extracted: true,
			provider: providerResult.providerName,
			extractionMethod: providerResult.extractionMethod,
		};

		const fetchResult: FetchResult = {
			content: [{ type: 'text' as const, text: buildFetchHeader(details) + finalText }],
			details,
		};
		return cacheFetchResult(fetchResult);
	}

	// Fallback
	return staticFetch(url, fetch);
}

/** Download file to temp location */
export async function downloadFile(
	url: string,
	fetchFn: typeof fetch = fetch,
): Promise<{ tempPath: string; contentType: string | null }> {
	const response = await fetchFn(url);
	const contentType = response.headers.get('content-type');
	const extension = getExtensionFromContentType(contentType, url);
	const tempPath = getTempFilePath('webfetch-download', extension);
	const buffer = Buffer.from(await response.arrayBuffer());

	const fs = await import('node:fs');
	fs.writeFileSync(tempPath, buffer);

	return { tempPath, contentType };
}

/** Get status of all providers */
export async function getProviderStatus(): Promise<
	{ name: string; available: boolean; priority: number }[]
> {
	const manager = await getProviderManager();
	const providers = manager.getAll();
	const results = await Promise.all(
		providers.map(async (p: { name: string; priority: number; isAvailable: () => boolean | Promise<boolean> }) => {
			const availableResult = p.isAvailable();
			const available = availableResult instanceof Promise ? await availableResult : availableResult;
			return {
				name: p.name,
				available,
				priority: p.priority,
			};
		})
	);
	return results;
}

// ============================================================================
// Research query functions
// ============================================================================

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

/** Send a partial update through the streaming callback */
function sendStreamingUpdate(config: StreamingConfig, content: string, phase: FetchPhase): void {
	config.callback?.({
		content: [{ type: 'text', text: content }],
		details: { phase, url: config.url },
	});
}

/** Yield to event loop to allow UI updates to be processed */
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
