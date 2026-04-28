/**
 * pi-webfetch Extension
 *
 * Fetches remote resources (URLs) and processes them based on content type:
 * - HTML: Browser rendering via providers (agent-browser, clawfetch)
 * - Text: Returned as-is
 * - Binary: Downloaded to temp directory
 *
 * Uses a provider abstraction layer for flexible content extraction backends.
 */

import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from 'cheerio';
import TurndownService from 'turndown';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import {
	createProviderManager,
	type ProviderManager,
	type ProviderFetchResult,
	type NoProviderResult,
	type ProviderConfig,
	type FetchConfig,
} from '../src/providers';

/** Maximum size for markdown content (100KB) */
export const MAX_MARKDOWN_SIZE = 100 * 1024;

/** Common binary file extensions */
export const BINARY_EXTENSIONS = [
	'.pdf',
	'.zip',
	'.gz',
	'.tar',
	'.rar',
	'.7z',
	'.doc',
	'.docx',
	'.xls',
	'.xlsx',
	'.ppt',
	'.pptx',
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.bmp',
	'.ico',
	'.webp',
	'.svg',
	'.mp3',
	'.mp4',
	'.avi',
	'.mov',
	'.wmv',
	'.flv',
	'.webm',
	'.exe',
	'.dmg',
	'.pkg',
	'.deb',
	'.rpm',
	'.appimage',
	'.ttf',
	'.otf',
	'.woff',
	'.woff2',
	'.eot',
];

/**
 * Check if URL likely points to binary content based on extension
 */
export function isLikelyBinaryUrl(url: string): boolean {
	const urlWithoutQuery = url.split(/[?#]/)[0].toLowerCase();
	return BINARY_EXTENSIONS.some((ext) => urlWithoutQuery.endsWith(ext));
}

/**
 * Detect if URL is a GitHub blob/file URL and return the raw URL
 */
export function convertGitHubToRaw(url: string): { rawUrl: string; isGitHubRaw: boolean } {
	const githubBlobMatch = url.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
	);
	if (githubBlobMatch) {
		const [, user, repo, branch, ...pathParts] = githubBlobMatch;
		const path = pathParts.join('/');
		return {
			rawUrl: `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`,
			isGitHubRaw: true,
		};
	}
	return { rawUrl: url, isGitHubRaw: false };
}

/**
 * Extract main content from HTML using cheerio
 */
export function extractMainContent(html: string): { content: string; extracted: boolean } {
	const $ = load(html);

	$(
		'script, style, nav, footer, header, aside, .header, .footer, .sidebar, .navbar, .repo-header, .commit-placeholder',
	).remove();

	const contentSelectors = [
		'article',
		'main',
		'[role="main"]',
		'.markdown-body',
		'.file-content',
		'.file-body',
		'.content',
		'#content',
		'.article-content',
		'.post-content',
		'.entry-content',
		'#readme',
		'.readme',
	];

	for (const selector of contentSelectors) {
		const $content = $(selector);
		if ($content.length > 0) {
			const text = $.html($content);
			if (text.length > 500) {
				return { content: text, extracted: true };
			}
		}
	}

	const $body = $('body');
	if ($body.length > 0) {
		return { content: $.html($body), extracted: true };
	}
	return { content: html, extracted: false };
}

/**
 * Detect if a page is likely a JavaScript-heavy SPA
 */
export function detectLikelySPA(html: string): {
	likely: boolean;
	reason?: string;
	selector?: string;
} {
	const $ = load(html);

	const contentSelectors = [
		{ sel: 'article', name: '<article>' },
		{ sel: 'main', name: '<main>' },
		{ sel: '[role="main"]', name: '[role="main"]' },
		{ sel: '.article-content', name: '.article-content' },
		{ sel: '.post-content', name: '.post-content' },
		{ sel: '.content', name: '.content' },
		{ sel: '#content', name: '#content' },
		{ sel: '.thread-content', name: '.thread-content' },
		{ sel: '#rce-thread-container', name: '#rce-thread-container' },
	];

	for (const { sel, name } of contentSelectors) {
		const $el = $(sel);
		if ($el.length > 0) {
			const hasChildren = $el.children().length > 0;
			const textContent = $el.text().trim();
			const htmlContent = $.html($el);

			if (hasChildren && textContent.length < 200 && htmlContent.length > 200) {
				return {
					likely: true,
					reason: `${name} exists but content appears empty (${textContent.length} chars) despite having structure`,
					selector: sel,
				};
			}

			if (!hasChildren && textContent.length < 50) {
				return {
					likely: true,
					reason: `${name} is empty - content likely requires JavaScript rendering`,
					selector: sel,
				};
			}
		}
	}

	const spaIndicators = [
		{ pattern: /id=["']rce-/, reason: 'Google Support RCE container detected' },
		{ pattern: /data-react/, reason: 'React data attributes detected' },
		{ pattern: /data-vue/, reason: 'Vue data attributes detected' },
		{ pattern: /__NEXT_DATA__/, reason: 'Next.js data block detected' },
		{ pattern: /__NUXT__/, reason: 'Nuxt data block detected' },
	];

	for (const { pattern, reason } of spaIndicators) {
		if (pattern.test(html)) {
			return { likely: true, reason };
		}
	}

	const $body = $('body');
	if ($body.length > 0) {
		const bodyText = $body.text().trim();
		const bodyHtml = $.html($body);
		if (bodyHtml.length > 50000 && bodyText.length < 500) {
			return {
				likely: true,
				reason: `Page has large HTML structure (${bodyHtml.length} chars) but minimal text (${bodyText.length} chars)`,
			};
		}
	}

	return { likely: false };
}

/**
 * Check if agent-browser CLI is available
 */
export function isBrowserAvailable(): boolean {
	try {
		execFileSync('agent-browser', ['--version'], { encoding: 'utf-8', stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/**
 * Determine if content type is text/markdown convertible
 */
export function isTextContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const ct = contentType.toLowerCase();
	return (
		ct.includes('text/html') ||
		ct.includes('text/plain') ||
		ct.includes('application/xhtml') ||
		ct.includes('application/xml') ||
		ct.includes('text/xml')
	);
}

/**
 * Determine if content type is binary (non-text)
 */
export function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) return true;
	const ct = contentType.toLowerCase();
	if (ct.includes('text/') || ct.includes('application/json') || ct.includes('application/xml')) {
		return false;
	}
	return true;
}

/**
 * Extract file extension from content type
 */
export function getExtensionFromContentType(contentType: string | null, url: string): string {
	if (!contentType) {
		const urlPath = new URL(url).pathname;
		const segments = urlPath.split('/');
		const lastSegment = segments.pop() || segments.pop();
		if (lastSegment && lastSegment.includes('.')) {
			const ext = lastSegment.split('.').pop();
			if (ext && ext.length < 10) return ext;
		}
		return 'bin';
	}

	const ct = contentType.toLowerCase();
	const mimeToExt: Record<string, string> = {
		'text/html': 'html',
		'text/plain': 'txt',
		'text/css': 'css',
		'text/javascript': 'js',
		'text/typescript': 'ts',
		'application/json': 'json',
		'application/xml': 'xml',
		'application/pdf': 'pdf',
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/gif': 'gif',
		'image/webp': 'webp',
		'image/svg+xml': 'svg',
		'image/x-icon': 'ico',
		'application/zip': 'zip',
		'application/gzip': 'gz',
		'application/x-tar': 'tar',
		'application/octet-stream': 'bin',
	};

	for (const [mime, ext] of Object.entries(mimeToExt)) {
		if (ct.includes(mime)) return ext;
	}
	return 'bin';
}

export interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	processedAs: 'markdown' | 'binary' | 'error' | 'spa' | 'fallback';
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
	extracted?: boolean;
	browserWarning?: string;
	provider?: string;
	extractionMethod?: string;
}

export interface FetchResult {
	content: Array<{ type: 'text'; text: string }>;
	details: WebfetchDetails;
}

/** Generate a unique temp file path */
export function getTempFilePath(prefix: string, extension: string): string {
	const id = randomBytes(8).toString('hex');
	return join(tmpdir(), `${prefix}-${id}.${extension}`);
}

/** Format bytes to human readable string */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build informative header for fetch results */
function buildFetchHeader(details: WebfetchDetails): string {
	const lines = [
		`## Fetched: ${details.url}`,
		`- **Status**: ${details.status}`,
		`- **Content-Type**: ${details.contentType || 'unknown'}`,
		`- **Processed as**: ${details.processedAs}`,
	];

	if (details.provider) {
		lines.push(`- **Provider**: ${details.provider}`);
	}
	if (details.extractionMethod) {
		lines.push(`- **Extraction**: ${details.extractionMethod}`);
	}
	if (details.originalSize !== undefined) {
		lines.push(`- **Original size**: ${formatBytes(details.originalSize)}`);
	}
	if (details.tempFileSize !== undefined) {
		lines.push(`- **Content size**: ${formatBytes(details.tempFileSize)}`);
	}
	if (details.truncated) {
		lines.push(`- **Note**: Content truncated to ${formatBytes(MAX_MARKDOWN_SIZE)}`);
	}
	if (details.extracted) {
		lines.push(`- **Content extracted**: Main content extracted from HTML`);
	}
	if (details.browserWarning) {
		lines.push(`⚠️ **${details.browserWarning}**`);
	}

	lines.push('\n---\n');
	return lines.join('\n');
}

/** Truncate text to max size */
export function truncateToSize(text: string, maxSize: number): string {
	const bytes = Buffer.byteLength(text, 'utf-8');
	if (bytes <= maxSize) return text;
	const buffer = Buffer.alloc(maxSize - 3);
	buffer.write(text, 0, 'utf-8');
	return buffer.toString('utf-8') + '...';
}

/** Convert HTML to Markdown using turndown */
export function convertToMarkdown(html: string): string {
	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
	});

	const preserveCodeBlocks = (node: {
		nodeName: string;
		querySelector: (sel: string) => Element | null;
	}): boolean => {
		return node.nodeName === 'PRE' && !!node.querySelector('code');
	};

	const replaceContent = (content: string): string => content;
	td.addRule('preserveCodeBlocks', {
		filter: preserveCodeBlocks,
		replacement: replaceContent,
	});
	return td.turndown(html);
}

/**
 * Protect code blocks by replacing them with placeholders.
 * Only protects fenced code blocks (```), not inline code.
 * Returns { content: with placeholders, blocks: original code blocks in order }
 */
function protectCodeBlocks(markdown: string): { content: string; blocks: string[] } {
	const blocks: string[] = [];
	// Only match fenced code blocks, not inline code
	const pattern = /```[\s\S]*?```/g;

	// Find all code block positions first
	const matches: Array<{ start: number; end: number; block: string }> = [];
	let match;
	while ((match = pattern.exec(markdown)) !== null) {
		matches.push({
			start: match.index,
			end: match.index + match[0].length,
			block: match[0],
		});
	}

	// Build new content with placeholders (in reverse order to preserve positions)
	let content = markdown;
	for (let i = matches.length - 1; i >= 0; i--) {
		const m = matches[i];
		blocks.unshift(m.block); // Add to front to maintain order
		content = content.slice(0, m.start) + `\x00CODEBLOCK_${i}\x00` + content.slice(m.end);
	}

	return { content, blocks };
}

/**
 * Restore code blocks from placeholders.
 */
function restoreCodeBlocks(content: string, blocks: string[]): string {
	blocks.forEach((block, idx) => {
		const placeholder = `\x00CODEBLOCK_${idx}\x00`;
		content = content.replace(placeholder, block);
	});
	return content;
}

/**
 * Remove markdown anchor links like [](#anchor)
 */
export function removeMarkdownAnchors(markdown: string): string {
	const { content, blocks } = protectCodeBlocks(markdown);
	const cleaned = content.replace(/\[\]\(#[^)]+\)/g, '');
	return restoreCodeBlocks(cleaned, blocks);
}

/**
 * Extract embedded images from markdown and store in temp file.
 * Replaces images with numbered references and returns path to temp file.
 * Preserves code blocks.
 */
export async function extractEmbeddedImages(
	markdown: string,
): Promise<{ content: string; tempFilePath?: string }> {
	// Protect code blocks first
	const { content: protectedContent, blocks } = protectCodeBlocks(markdown);

	// Match inline images only (not reference-style like ![alt][ref])
	// Must have format: ![alt](url "title") where URL doesn't start with [ (ref style)
	const imageRegex = /!\[([^\]]*)\]\((?!\[)([^)\s]+)(?:\s+"([^"]*)")?\)/g;
	const images: Array<{ alt: string; url: string; title?: string }> = [];

	let match;
	while ((match = imageRegex.exec(protectedContent)) !== null) {
		images.push({
			alt: match[1] || '',
			url: match[2],
			title: match[3],
		});
	}

	if (images.length === 0) {
		// Restore code blocks even if no images found
		return { content: restoreCodeBlocks(protectedContent, blocks) };
	}

	// Build URL -> ref number mapping first
	const seenUrls = new Map<string, number>();
	let refCounter = 1;
	images.forEach((img) => {
		if (!seenUrls.has(img.url)) {
			seenUrls.set(img.url, refCounter++);
		}
	});

	// Replace images with references using simple string replace
	let content = protectedContent;
	seenUrls.forEach((refNum, url) => {
		// Find which alt text was associated with this URL
		const imgInfo = images.find((i) => i.url === url);
		const alt = imgInfo?.alt || `Image${refNum}`;
		const placeholder = `![${alt}][ref-${refNum}]`;

		// Escape URL for regex
		const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// Match inline image with this URL: ![alt](url "title")
		const pattern = `!\\[([^\\]]*)\\]\\(${escapedUrl}\\)(?:\\s+"([^"]*)")?`;
		const urlRegex = new RegExp(pattern, 'g');
		content = content.replace(urlRegex, placeholder);
	});

	// Restore code blocks
	content = restoreCodeBlocks(content, blocks);

	// Build refs
	const refsContent = Array.from(seenUrls.entries())
		.map(([url, refNum]) => `[ref-${refNum}]: ${url}`)
		.join('\n');

	// Save to temp file with original markdown for reference
	const tempPath = getTempFilePath('webfetch-images', 'md');
	const fs = await import('node:fs');
	fs.writeFileSync(tempPath, `${markdown}\n\n---\n\n## Image References\n\n${refsContent}\n`);

	return { content, tempFilePath: tempPath };
}

/**
 * Remove embedded images from markdown (non-async version).
 * Preserves code blocks and reference-style images.
 */
export function stripEmbeddedImages(markdown: string): string {
	const { content, blocks } = protectCodeBlocks(markdown);
	// Only match inline images, not reference-style like ![alt][ref]
	const cleaned = content.replace(/!\[([^\]]*)\]\((?!\[)([^)\s]+)(?:\s+"([^"]*)")?\)/g, '$1');
	return restoreCodeBlocks(cleaned, blocks);
}

// Lazy-initialized provider manager
let providerManager: ProviderManager | null = null;

/**
 * Get or create the provider manager
 */
export function getProviderManager(): ProviderManager {
	if (!providerManager) {
		providerManager = createProviderManager();
	}
	return providerManager;
}

/**
 * Get content-type header via HEAD request (with GET fallback)
 */
async function probeContentType(url: string, fetchFn: typeof fetch): Promise<string | null> {
	try {
		const response = await fetchFn(url, {
			method: 'HEAD',
			headers: { 'User-Agent': 'pi-webfetch/1.0' },
		});
		return response.headers.get('content-type');
	} catch {
		try {
			const response = await fetchFn(url, {
				method: 'GET',
				headers: { 'User-Agent': 'pi-webfetch/1.0' },
			});
			return response.headers.get('content-type');
		} catch {
			return null;
		}
	}
}

/**
 * Main fetch function - uses provider system with static fallback
 */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	maxMarkdownSize: number = MAX_MARKDOWN_SIZE,
	options?: { provider?: string },
): Promise<FetchResult> {
	const { rawUrl, isGitHubRaw } = convertGitHubToRaw(url);
	const fetchUrl = isGitHubRaw ? rawUrl : url;

	// Determine if we should skip browser-based fetch
	const skipBrowser =
		isGitHubRaw ||
		isLikelyBinaryUrl(url) ||
		isBinaryContentType(await probeContentType(fetchUrl, fetchFn));

	// Try provider-based fetch for HTML pages
	if (!skipBrowser) {
		const manager = getProviderManager();
		const providerConfig: FetchConfig = {
			timeout: 30000,
			waitFor: 'networkidle',
		};

		if (options?.provider) {
			providerConfig.provider = options.provider;
		}

		const providerResult = await manager.fetch(url, providerConfig);

		if (providerResult && 'content' in providerResult) {
			const result = providerResult as ProviderFetchResult;
			const originalSize = Buffer.byteLength(result.content, 'utf-8');
			const truncated = originalSize > maxMarkdownSize;
			const content = truncateToSize(result.content, maxMarkdownSize);

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

		// Provider failed - check if we have any available providers
		if (!manager.hasAvailableProvider()) {
			// No providers available - use static fetch
			return await staticFetch(url, fetchUrl, fetchFn, isGitHubRaw, maxMarkdownSize);
		}
	}

	// Static HTTP fetch fallback
	return await staticFetch(url, fetchUrl, fetchFn, isGitHubRaw, maxMarkdownSize);
}

/**
 * Static HTTP fetch (no browser rendering)
 */
async function staticFetch(
	originalUrl: string,
	fetchUrl: string,
	fetchFn: typeof fetch,
	isGitHubRaw: boolean,
	maxMarkdownSize: number,
): Promise<FetchResult> {
	let response: Response;
	try {
		response = await fetchFn(fetchUrl, {
			headers: {
				'User-Agent': 'pi-webfetch/1.0',
				Accept: isGitHubRaw
					? 'text/plain,text/markdown,text/*,*/*'
					: 'text/html,text/plain,application/xml,application/json,*/*',
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const details: WebfetchDetails = {
			url: originalUrl,
			contentType: null,
			status: 0,
			processedAs: 'error',
			browserWarning: 'Static fetch failed',
		};
		return {
			content: [
				{
					type: 'text',
					text: buildFetchHeader(details) + `Failed to fetch ${originalUrl}: ${message}`,
				},
			],
			details,
		};
	}

	const contentType = response.headers.get('content-type');
	const status = response.status;

	if (!response.ok) {
		const details: WebfetchDetails = {
			url: originalUrl,
			contentType,
			status,
			processedAs: 'error',
			browserWarning: 'Static fetch: HTTP error',
		};
		return {
			content: [
				{
					type: 'text',
					text: buildFetchHeader(details) + `HTTP ${status} for ${originalUrl}`,
				},
			],
			details,
		};
	}

	// GitHub raw or plain text - use as-is
	if (
		isGitHubRaw ||
		contentType?.includes('text/plain') ||
		contentType?.includes('text/markdown')
	) {
		try {
			const text = await response.text();
			const originalSize = Buffer.byteLength(text, 'utf-8');
			const truncated = originalSize > maxMarkdownSize;
			const finalText = truncateToSize(text, maxMarkdownSize);

			const details: WebfetchDetails = {
				url: originalUrl,
				contentType: isGitHubRaw ? 'text/plain' : contentType,
				status,
				processedAs: 'markdown',
				originalSize,
				tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
				truncated,
				browserWarning: 'Using static fetch (provider unavailable)',
			};

			return {
				content: [{ type: 'text', text: buildFetchHeader(details) + finalText }],
				details,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details: WebfetchDetails = {
				url: originalUrl,
				contentType,
				status,
				processedAs: 'error',
			};
			return {
				content: [
					{
						type: 'text',
						text:
							buildFetchHeader(details) +
							`Failed to process ${originalUrl}: ${message}`,
					},
				],
				details,
			};
		}
	}

	// HTML - static extraction fallback
	if (contentType?.includes('text/html')) {
		try {
			const html = await response.text();
			const originalSize = Buffer.byteLength(html, 'utf-8');
			const { content: extractedHtml, extracted } = extractMainContent(html);
			let markdown = convertToMarkdown(extractedHtml);
			const truncated = Buffer.byteLength(markdown, 'utf-8') > maxMarkdownSize;
			markdown = truncateToSize(markdown, maxMarkdownSize);

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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const details: WebfetchDetails = {
				url: originalUrl,
				contentType,
				status,
				processedAs: 'error',
			};
			return {
				content: [
					{
						type: 'text',
						text:
							buildFetchHeader(details) +
							`Failed to process ${originalUrl}: ${message}`,
					},
				],
				details,
			};
		}
	}

	// Binary content - download to temp file
	try {
		const buffer = await response.arrayBuffer();
		const data = Buffer.from(buffer);
		const size = data.byteLength;
		const extension = getExtensionFromContentType(contentType, originalUrl);
		const tempPath = getTempFilePath('webfetch', extension);

		const fs = await import('node:fs');
		fs.writeFileSync(tempPath, data);

		const details: WebfetchDetails = {
			url: originalUrl,
			contentType,
			status,
			processedAs: 'binary',
			tempFileSize: size,
			browserWarning: 'Binary file downloaded',
		};

		return {
			content: [
				{
					type: 'text',
					text:
						buildFetchHeader(details) +
						`Downloaded binary file to: ${tempPath}\nSize: ${formatBytes(size)}, Content-Type: ${contentType || 'unknown'}`,
				},
			],
			details,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const details: WebfetchDetails = {
			url: originalUrl,
			contentType,
			status,
			processedAs: 'error',
		};
		return {
			content: [
				{
					type: 'text',
					text:
						buildFetchHeader(details) + `Failed to download ${originalUrl}: ${message}`,
				},
			],
			details,
		};
	}
}

/**
 * Download a file from URL to a specific destination path
 */
export async function downloadFile(
	url: string,
	destination: string,
	fetchFn: typeof fetch = fetch,
): Promise<{ success: boolean; message: string; size?: number; contentType?: string }> {
	try {
		const response = await fetchFn(url, {
			headers: {
				'User-Agent': 'pi-webfetch/1.0',
			},
		});

		if (!response.ok) {
			return {
				success: false,
				message: `HTTP ${response.status} for ${url}`,
			};
		}

		const contentType = response.headers.get('content-type') || undefined;
		const buffer = await response.arrayBuffer();
		const data = Buffer.from(buffer);
		const size = data.byteLength;

		const fs = await import('node:fs');
		fs.writeFileSync(destination, data);

		return {
			success: true,
			message: `Downloaded to: ${destination}`,
			size,
			contentType,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			message: `Failed to download ${url}: ${message}`,
		};
	}
}

/**
 * Explicit browser-based fetch for SPA pages using provider system
 */
export async function fetchUrlWithBrowser(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000,
): Promise<FetchResult> {
	const manager = getProviderManager();
	const config: ProviderConfig = {
		timeout,
		waitFor: waitFor as 'networkidle' | 'domcontentloaded',
	};

	const result = await manager.fetch(url, config);

	if (result && 'content' in result) {
		const providerResult = result as ProviderFetchResult;
		const text = providerResult.content;
		const originalSize = Buffer.byteLength(text, 'utf-8');
		const truncated = originalSize > MAX_MARKDOWN_SIZE;
		const finalText = truncateToSize(text, MAX_MARKDOWN_SIZE);

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

	const errorResult = result as NoProviderResult;
	const details: WebfetchDetails = {
		url,
		contentType: 'text/html',
		status: 200,
		processedAs: 'error',
		browserWarning: errorResult.error,
	};

	return {
		content: [
			{
				type: 'text',
				text:
					buildFetchHeader(details) +
					`Provider fetch failed.\n\nError: ${errorResult.error}\n\n` +
					`Attempted providers: ${errorResult.attemptedProviders.join(', ') || 'none'}\n\n` +
					'Install a provider: npm i -g agent-browser  # or: npm install -g clawfetch',
			},
		],
		details,
	};
}

/**
 * Get status of all providers
 */
export function getProviderStatus(): { name: string; available: boolean; priority: number }[] {
	const manager = getProviderManager();
	return manager.getAll().map((p) => ({
		name: p.name,
		available: p.isAvailable(),
		priority: p.priority,
	}));
}

export default function (pi: ExtensionAPI) {
	// Startup validation: check for available providers
	const providerStatus = getProviderStatus();
	const availableProviders = providerStatus.filter((p) => p.available);

	// Notify about provider status (only if UI is available)
	try {
		const piAny = pi as unknown as {
			ui?: { notify: (msg: string, type?: 'info' | 'warning' | 'error') => void };
		};
		if (piAny.ui) {
			if (availableProviders.length === 0) {
				piAny.ui.notify(
					'⚠️ pi-webfetch: No browser providers installed. HTML pages will use static fetch.\n' +
						'Install a provider:\n' +
						'  npm i -g agent-browser && agent-browser install\n' +
						'  npm install -g clawfetch\n' +
						"Run 'webfetch-providers' to check status.",
					'warning',
				);
			} else {
				const providerList = availableProviders.map((p) => p.name).join(', ');
				piAny.ui.notify(
					`✅ pi-webfetch: ${availableProviders.length} provider(s) available (${providerList})`,
					'info',
				);
			}
		}
	} catch {
		// UI not available, skip notification
	}

	pi.registerTool({
		name: 'webfetch',
		label: 'Web Fetch',
		description:
			'Fetch a remote URL and process its content. ' +
			'Uses provider system (agent-browser, clawfetch) for HTML pages. ' +
			'Falls back to static fetch if no provider available. ' +
			'Binary files are downloaded to temp directory.',
		parameters: Type.Object({
			url: Type.String({ description: 'The URL to fetch' }),
			provider: Type.Optional(
				Type.Union([Type.Literal('default'), Type.Literal('clawfetch')]),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const { url, provider } = params;
			return fetchUrl(url, fetch, MAX_MARKDOWN_SIZE, { provider });
		},
	});

	pi.registerTool({
		name: 'webfetch-spa',
		label: 'Web Fetch (SPA)',
		description:
			'Explicitly fetch using browser rendering via provider system. ' +
			'For JavaScript-heavy pages like Reddit, Google Support, Twitter/X, Notion, etc. ' +
			'Requires: npm i -g agent-browser  # or: npm install -g clawfetch',
		parameters: Type.Object({
			url: Type.String({ description: 'The URL to fetch' }),
			waitFor: Type.Optional(
				Type.Union([Type.Literal('networkidle'), Type.Literal('domcontentloaded')]),
			),
			timeout: Type.Optional(Type.Number()),
		}),

		async execute(_toolCallId, params, _signal) {
			const { url, waitFor = 'networkidle', timeout = 30000 } = params;
			return fetchUrlWithBrowser(url, waitFor, timeout);
		},
	});

	pi.registerTool({
		name: 'download-file',
		label: 'Download File',
		description:
			'Download a file from a URL to a specific destination path. ' +
			'Use this for binary files (PDF, ZIP, images, etc.) or any file you want to save directly. ' +
			'URL and destination are required.',
		parameters: Type.Object({
			url: Type.String({ description: 'The URL of the file to download' }),
			destination: Type.String({
				description: 'The destination path where the file will be saved',
			}),
		}),

		async execute(_toolCallId, params, _signal) {
			const { url, destination } = params;
			const result = await downloadFile(url, destination, fetch);

			const lines = [
				`## Download: ${url}`,
				`- **Destination**: ${destination}`,
				`- **Status**: ${result.success ? 'Success' : 'Failed'}`,
			];

			if (result.size !== undefined) {
				lines.push(`- **Size**: ${formatBytes(result.size)}`);
			}
			if (result.contentType) {
				lines.push(`- **Content-Type**: ${result.contentType}`);
			}
			lines.push('\n---\n');
			lines.push(result.message);

			return {
				content: [{ type: 'text', text: lines.join('\n') }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: 'webfetch-providers',
		label: 'Web Fetch Providers',
		description: 'Get status of available web fetch providers (agent-browser, clawfetch).',
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal) {
			const providers = getProviderStatus();
			const lines = [
				'## Web Fetch Providers',
				'',
				'| Provider | Available | Priority |',
				'|----------|-----------|----------|',
			];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Available' : '❌ Not installed';
				lines.push(`| ${p.name} | ${status} | ${p.priority} |`);
			}

			lines.push('');
			lines.push('### Installation');
			lines.push('```bash');
			lines.push('npm i -g agent-browser && agent-browser install  # Default provider');
			lines.push(
				'npm install -g clawfetch                         # Alternative with fast-paths',
			);
			lines.push('```');

			return {
				content: [{ type: 'text', text: lines.join('\n') }],
				details: { providers },
			};
		},
	});

	// Register /webfetch:info command
	pi.registerCommand('webfetch:info', {
		description: 'Show webfetch provider status and installation',
		handler: async (_args, ctx) => {
			const providers = getProviderStatus();
			const available = providers.filter((p) => p.available);

			const lines = ['# 📡 webfetch Providers', '', '## Status', ''];

			for (const p of providers.sort((a, b) => b.priority - a.priority)) {
				const status = p.available ? '✅ Installed' : '❌ Missing';
				const features = p.name === 'default' ? 'agent-browser' : 'clawfetch';
				lines.push(`- **${p.name}** (${features}): ${status}`);
			}

			if (available.length === 0) {
				lines.push(
					'',
					'## Installation',
					'',
					'```bash',
					'# agent-browser (default)',
					'npm i -g agent-browser && agent-browser install',
					'',
					'# clawfetch (with GitHub/Reddit fast-paths)',
					'npm install -g clawfetch',
					'```',
				);
				lines.push('', '⚠️ No providers installed - HTML pages will use static fetch.');
			} else {
				lines.push('', `✅ ${available.length} provider(s) ready`);
			}

			const message = lines.join('\n');
			ctx.ui.notify(message, 'info');
		},
	});
}
