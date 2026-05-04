/**
 * Fetch Service
 *
 * Main orchestration for URL fetching with provider selection.
 */

import type { WebfetchDetails, FetchResult, ProviderConfig, ProviderFetchResult } from '../types.js';
import { removeMarkdownAnchors, extractEmbeddedImages } from '../markdown.js';
import { truncateToSize, getTempFilePath } from '../utils/formatting.js';
import { isLikelyBinaryUrl } from '../utils/url.js';
import { getExtensionFromContentType } from '../content-types.js';
import { buildFetchHeader } from './header-builder.js';
import { cacheFetchResult, getCachedResult } from './cache-service.js';
import { staticFetch, handleBinary } from './static-fetch.js';
import { getProviderManager } from './session-manager.js';

const MAX_MARKDOWN_SIZE = 100 * 1024;

/**
 * Main webfetch function - auto-detects best fetch method
 */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	provider?: string,
): Promise<FetchResult> {
	// Check cache first
	const cached = await getCachedResult(url);
	if (cached) {
		return cached;
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
				return processProviderResult(providerResult as ProviderFetchResult, url);
			}
		} catch {
			// Provider failed, fall back to static fetch
		}
	}

	// Fallback to static fetch
	return cacheFetchResult(await staticFetch(url, fetchFn));
}

/**
 * Process result from a provider
 */
async function processProviderResult(result: ProviderFetchResult, url: string): Promise<FetchResult> {
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

	return cacheFetchResult({
		content: [{ type: 'text' as const, text: buildFetchHeader(details) + content }],
		details,
	});
}

/**
 * Explicit browser-based fetch for SPAs
 */
export async function webfetchSPA(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000,
): Promise<FetchResult> {
	// Check cache first
	const cached = await getCachedResult(url);
	if (cached) {
		return cached;
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

		return cacheFetchResult({
			content: [{ type: 'text' as const, text: buildFetchHeader(details) + finalText }],
			details,
		});
	}

	// Fallback
	return staticFetch(url, fetch);
}

/**
 * Download file to temp location
 */
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
