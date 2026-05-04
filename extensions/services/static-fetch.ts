/**
 * Static Fetch Service
 *
 * Handles static HTTP fetch without browser rendering.
 */

import type { FetchResult, WebfetchDetails } from '../types.js';
import { isBinaryContentType, getExtensionFromContentType } from '../content-types.js';
import { extractMainContent, convertToMarkdown } from '../html.js';
import { removeMarkdownAnchors, extractEmbeddedImages } from '../markdown.js';
import { convertGitHubToRaw } from '../utils/url.js';
import { getTempFilePath, truncateToSize } from '../utils/formatting.js';
import { buildFetchHeader } from './header-builder.js';

const MAX_MARKDOWN_SIZE = 100 * 1024;

/**
 * Static HTML fetch with content extraction
 */
export async function staticFetch(url: string, fetchFn: typeof fetch): Promise<FetchResult> {
	const originalUrl = url;
	const { rawUrl, isGitHubRaw } = convertGitHubToRaw(url);

	try {
		const response = await fetchFn(rawUrl);
		const status = response.status;
		const contentType = response.headers.get('content-type');

		// Binary content
		if (isBinaryContentType(contentType)) {
			return handleBinaryFetch(originalUrl, contentType, response);
		}

		// Text/markdown content (GitHub raw files)
		if (
			isGitHubRaw ||
			contentType?.includes('text/plain') ||
			contentType?.includes('text/markdown')
		) {
			return handleMarkdownFetch(originalUrl, contentType, status, response);
		}

		// HTML content
		if (contentType?.includes('text/html')) {
			return handleHtmlFetch(originalUrl, contentType, status, response);
		}

		// Unknown content type - return as text
		return handleUnknownFetch(originalUrl, contentType, status, response);
	} catch (error) {
		return buildErrorResult(originalUrl, error);
	}
}

/**
 * Handle binary content fetch
 */
async function handleBinaryFetch(
	url: string,
	contentType: string | null,
	response: Response,
): Promise<FetchResult> {
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
}

/**
 * Handle markdown/text content fetch
 */
async function handleMarkdownFetch(
	url: string,
	contentType: string | null,
	status: number,
	response: Response,
): Promise<FetchResult> {
	const text = await response.text();
	const originalSize = Buffer.byteLength(text, 'utf-8');
	const truncated = originalSize > MAX_MARKDOWN_SIZE;
	const finalText = truncateToSize(text, MAX_MARKDOWN_SIZE);

	const details: WebfetchDetails = {
		url,
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

/**
 * Handle HTML content fetch
 */
async function handleHtmlFetch(
	url: string,
	contentType: string | null,
	status: number,
	response: Response,
): Promise<FetchResult> {
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
		url,
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

/**
 * Handle unknown content type
 */
async function handleUnknownFetch(
	url: string,
	contentType: string | null,
	status: number,
	response: Response,
): Promise<FetchResult> {
	const text = await response.text();
	const details: WebfetchDetails = {
		url,
		contentType,
		status,
		processedAs: 'error',
	};

	return {
		content: [{ type: 'text', text: buildFetchHeader(details) + text }],
		details,
	};
}

/**
 * Build error result
 */
function buildErrorResult(url: string, error: unknown): FetchResult {
	const details: WebfetchDetails = {
		url,
		contentType: null,
		status: 0,
		processedAs: 'error',
	};

	return {
		content: [{ type: 'text', text: buildFetchHeader(details) + `Error: ${error}` }],
		details,
	};
}

/**
 * Handle binary content from URL
 */
export async function handleBinary(url: string, fetchFn: typeof fetch): Promise<FetchResult> {
	try {
		const response = await fetchFn(url);
		const contentType = response.headers.get('content-type') || 'application/octet-stream';
		return handleBinaryFetch(url, contentType, response);
	} catch (error) {
		return buildErrorResult(url, error);
	}
}
