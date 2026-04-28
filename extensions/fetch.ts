// Fetch functions for webfetch extension

import type {
	WebfetchDetails,
	FetchResult,
	ProviderConfig,
	ProviderFetchResult,
} from './types.js';
import {
	convertGitHubToRaw,
	isLikelyBinaryUrl,
	getTempFilePath,
	formatBytes,
	truncateToSize,
} from './helpers.js';
import {
	isBinaryContentType,
	getExtensionFromContentType,
} from './content-types.js';
import { extractMainContent, convertToMarkdown } from './html.js';
import { removeMarkdownAnchors, extractEmbeddedImages } from './markdown.js';

const MAX_MARKDOWN_SIZE = 100 * 1024;

// Lazy-initialized provider manager
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providerManager: any = null;

async function getProviderManager() {
	if (!providerManager) {
		const module = await import('../src/providers/manager.js');
		providerManager = new module.ProviderManager();
	}
	return providerManager;
}

/** Build the fetch result header with metadata */
function buildFetchHeader(details: WebfetchDetails): string {
	const lines = [`## Fetch Result\n`, `**URL:** ${details.url}\n`, `**Status:** ${details.status}`];

	if (details.contentType) lines.push(`**Content-Type:** ${details.contentType}`);

	const processed = details.processedAs || 'unknown';
	lines.push(`**Processed as:** ${processed}`);

	if (details.originalSize) lines.push(`**Original size:** ${formatBytes(details.originalSize)}`);
	if (details.tempFileSize) lines.push(`**Output size:** ${formatBytes(details.tempFileSize)}`);
	if (details.provider) lines.push(`**Provider:** ${details.provider}`);
	if (details.extractionMethod) lines.push(`**Method:** ${details.extractionMethod}`);
	if (details.browserWarning) lines.push(`\n> ⚠️ ${details.browserWarning}`);
	if (details.truncated) lines.push(`\n> ⚠️ Content truncated to ${formatBytes(MAX_MARKDOWN_SIZE)}`);

	return lines.join('\n') + '\n\n<!-- -->\n\n';
}

// ============================================================================
// Main fetch functions
// ============================================================================

/** Main webfetch function - auto-detects best fetch method */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	provider?: string
): Promise<FetchResult> {
	// Check if URL is likely binary
	if (isLikelyBinaryUrl(url)) {
		return handleBinary(url, fetchFn);
	}

	// Check for provider-based fetch (SPA or GitHub content)
	const manager = await getProviderManager();
	const detection = manager.detectUrl(url);

	// Check if URL is a raw GitHub URL (should use static fetch, not provider)
	const hostname = new URL(url).hostname.toLowerCase();
	const isRawGitHubUrl = hostname === 'raw.githubusercontent.com';

	// Use detection flags to determine if provider should be used
	// Provider is used for GitHub web URLs, Reddit URLs, or SPAs
	// Raw GitHub URLs should use static fetch directly
	const shouldUseProvider = (detection.isGitHub && !isRawGitHubUrl) || detection.isReddit || detection.isLikelySPA || !!provider;

	if (shouldUseProvider) {
		const config: ProviderConfig = { forceProvider: provider };
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
				provider: 'provider',
				extractionMethod: result.extractionMethod,
			};

			return {
				content: [{ type: 'text', text: buildFetchHeader(details) + content }],
				details,
			};
		}
	}

	// Fallback to static fetch
	return staticFetch(url, fetchFn);
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
		if (isGitHubRaw || contentType?.includes('text/plain') || contentType?.includes('text/markdown')) {
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
		const details: WebfetchDetails = { url, contentType: null, status: 0, processedAs: 'error' };
		return { content: [{ type: 'text', text: `Error downloading binary: ${error}` }], details };
	}
}

// ============================================================================
// Convenience functions
// ============================================================================

/** Convenience wrapper for fetchUrl */
export async function webfetch(url: string, fetchFn?: typeof fetch, provider?: string): Promise<FetchResult> {
	return fetchUrl(url, fetchFn, provider);
}

/** Explicit browser-based fetch for SPAs */
export async function webfetchSPA(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000
): Promise<FetchResult> {
	const manager = await getProviderManager();
	const config: ProviderConfig = { timeout, waitFor: waitFor as 'networkidle' | 'domcontentloaded' };
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
			provider: 'provider',
			extractionMethod: providerResult.extractionMethod,
		};

		return {
			content: [{ type: 'text', text: buildFetchHeader(details) + finalText }],
			details,
		};
	}

	// Fallback
	return staticFetch(url, fetch);
}

/** Download file to temp location */
export async function downloadFile(
	url: string,
	fetchFn: typeof fetch = fetch
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
export async function getProviderStatus(): Promise<{ name: string; available: boolean; priority: number }[]> {
	const manager = await getProviderManager();
	const providers = manager.getProviders();
	return providers.map((p: { name: string; isAvailable: () => boolean; priority: number }) => ({
		name: p.name,
		available: p.isAvailable(),
		priority: p.priority,
	}));
}
