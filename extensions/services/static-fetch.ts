/**
 * Static Fetch Service
 *
 * Handles static HTTP fetch without browser rendering.
 */

import type { FetchResult, WebfetchDetails } from '../types.js';
import { isBinaryContentType, getExtensionFromContentType } from '../content-types.js';
import { extractMainContent, convertToMarkdown } from '../html.js';
import { removeMarkdownAnchors, extractEmbeddedImages, unescapeBrackets } from '../markdown.js';

/**
 * Once-per-process `browserWarning` flag (M3.D). The first
 * call to land in the static-fallback path emits the
 * `browserWarning` line so the user sees the warning exactly
 * once. Subsequent calls set `staticOnly: true` instead.
 * The flag is process-scoped (it tracks the lifetime of the
 * `AGENT_BROWSER_SESSION`).
 */
let staticOnlyWarningConsumed = false;

function consumeStaticOnlyWarning(): boolean {
	if (staticOnlyWarningConsumed) return false;
	staticOnlyWarningConsumed = true;
	return true;
}

/**
 * Test-only helper: reset the once-per-process warning flag
 * between test cases. Not exported from `index.ts`; reachable
 * via `import { __resetStaticOnlyWarningForTest } from
 * '.../static-fetch.js'`.
 */
export function __resetStaticOnlyWarningForTest(): void {
	staticOnlyWarningConsumed = false;
}
import { convertGitHubToRaw } from '../utils/url.js';
import { getTempFilePath, truncateToSize } from '../utils/formatting.js';
import { buildFetchHeader, wrapUntrustedContent } from './header-builder.js';

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
		// v0.9.0 (M3.C): renamed `markdown` to `static` so
		// the user-facing `Processed as: ...` header
		// distinguishes a static fetch from a real-browser
		// fetch. The internal `processedAs` enum is widened
		// accordingly; old values stay valid for back-compat.
		processedAs: 'static',
		originalSize,
		tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
		truncated,
		// For plain-text / markdown inputs the "raw" is byte-identical
		// to the processed content, but we still surface it so the
		// research service can write `input_raw.md` (or `.txt` for
		// `text/plain`). The subagent's `grep` works the same way on
		// either file, but having both keeps the layout uniform.
		rawContent: text,
		rawContentType: contentType,
	};

	return {
		content: [{ type: 'text', text: buildFetchHeader(details) + wrapUntrustedContent(finalText) }],
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
	markdown = unescapeBrackets(markdown);
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
		// Static fetch fallback path: read HTML / text / json
		// over plain HTTP. The user-facing `Processed as: ...`
		// header reads as `static` (or `fallback` for the
		// graceful-degradation path). Distinguishing the two
		// helps the user spot when the browser was unavailable.
		processedAs: 'fallback',
		originalSize,
		tempFileSize: Buffer.byteLength(markdown, 'utf-8'),
		truncated,
		extracted,
		// v0.9.0 (M3.D): the `browserWarning` is shown once
		// per process. The first call to land in the
		// static-fallback path sets it; subsequent calls set
		// `staticOnly: true` instead so the warning is sticky
		// (visible in the first result) but does not repeat
		// on every call. The warning is reset on a new
		// process, matching the lifetime of the
		// `AGENT_BROWSER_SESSION`.
		...(consumeStaticOnlyWarning()
			? {
					browserWarning: 'Using static fetch (no browser provider available)',
				}
			: { staticOnly: true }),
		// Surface the raw HTML so the research service can write
		// `input_raw.html` in the session work dir. The subagent
		// can re-read the original markup when the markdown
		// conversion drops content (e.g. metadata in `<meta>`,
		// hidden JSON in `<script type="application/ld+json">`,
		// attribute values, etc.).
		rawContent: html,
		rawContentType: contentType ?? 'text/html',
	};

	return {
		content: [{ type: 'text', text: buildFetchHeader(details) + wrapUntrustedContent(markdown) }],
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
		content: [{ type: 'text', text: buildFetchHeader(details) + wrapUntrustedContent(text) }],
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
		content: [{ type: 'text', text: buildFetchHeader(details) + wrapUntrustedContent(`Error: ${error}`) }],
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
