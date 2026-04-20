/**
 * pi-webfetch Extension
 *
 * Fetches remote resources (URLs) and processes them based on content type:
 * - HTML: Browser rendering via agent-browser (falls back to static with warning)
 * - Text: Returned as-is
 * - Binary: Downloaded to temp directory
 */

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { load } from "cheerio";
import TurndownService from "turndown";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/** Maximum size for markdown content (100KB) */
export const MAX_MARKDOWN_SIZE = 100 * 1024;

/** Common binary file extensions */
export const BINARY_EXTENSIONS = [
	'.pdf', '.zip', '.gz', '.tar', '.rar', '.7z',
	'.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
	'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
	'.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
	'.exe', '.dmg', '.pkg', '.deb', '.rpm', '.appimage',
	'.ttf', '.otf', '.woff', '.woff2', '.eot',
];

/**
 * Check if URL likely points to binary content based on extension
 */
export function isLikelyBinaryUrl(url: string): boolean {
	// Strip query parameters and fragment before checking extension
	const urlWithoutQuery = url.split(/[?#]/)[0].toLowerCase();
	return BINARY_EXTENSIONS.some(ext => urlWithoutQuery.endsWith(ext));
}

/**
 * Detect if URL is a GitHub blob/file URL and return the raw URL
 */
export function convertGitHubToRaw(url: string): { rawUrl: string; isGitHubRaw: boolean } {
	const githubBlobMatch = url.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
	);
	if (githubBlobMatch) {
		const [, user, repo, branch, ...pathParts] = githubBlobMatch;
		const path = pathParts.join("/");
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

	$('script, style, nav, footer, header, aside, .header, .footer, .sidebar, .navbar, .repo-header, .commit-placeholder').remove();

	const contentSelectors = [
		'article', 'main', '[role="main"]', '.markdown-body', '.file-content',
		'.file-body', '.content', '#content', '.article-content', '.post-content',
		'.entry-content', '#readme', '.readme',
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
export function detectLikelySPA(html: string): { likely: boolean; reason?: string; selector?: string } {
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
		ct.includes("text/html") ||
		ct.includes("text/plain") ||
		ct.includes("application/xhtml") ||
		ct.includes("application/xml") ||
		ct.includes("text/xml")
	);
}

/**
 * Determine if content type is binary (non-text)
 */
export function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) return true;
	const ct = contentType.toLowerCase();
	if (ct.includes("text/") || ct.includes("application/json") || ct.includes("application/xml")) {
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
		const segments = urlPath.split("/");
		const lastSegment = segments.pop() || segments.pop();
		if (lastSegment && lastSegment.includes(".")) {
			const ext = lastSegment.split(".").pop();
			if (ext && ext.length < 10) return ext;
		}
		return "bin";
	}

	const ct = contentType.toLowerCase();
	const mimeToExt: Record<string, string> = {
		"text/html": "html", "text/plain": "txt", "text/css": "css",
		"text/javascript": "js", "text/typescript": "ts", "application/json": "json",
		"application/xml": "xml", "application/pdf": "pdf", "image/jpeg": "jpg",
		"image/png": "png", "image/gif": "gif", "image/webp": "webp",
		"image/svg+xml": "svg", "image/x-icon": "ico", "application/zip": "zip",
		"application/gzip": "gz", "application/x-tar": "tar", "application/octet-stream": "bin",
	};

	for (const [mime, ext] of Object.entries(mimeToExt)) {
		if (ct.includes(mime)) return ext;
	}
	return "bin";
}

export interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	processedAs: "markdown" | "binary" | "error" | "spa" | "fallback";
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
	extracted?: boolean;
	browserWarning?: string;
}

export interface FetchResult {
	content: Array<{ type: "text"; text: string }>;
	details: WebfetchDetails;
}

/** Generate a unique temp file path */
export function getTempFilePath(prefix: string, extension: string): string {
	const id = randomBytes(8).toString("hex");
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
		`- **Content-Type**: ${details.contentType || "unknown"}`,
		`- **Processed as**: ${details.processedAs}`,
	];

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

	lines.push("\n---\n");
	return lines.join("\n");
}

/** Truncate text to max size */
export function truncateToSize(text: string, maxSize: number): string {
	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes <= maxSize) return text;
	const buffer = Buffer.alloc(maxSize - 3);
	buffer.write(text, 0, "utf-8");
	return buffer.toString("utf-8") + "...";
}

/** Convert HTML to Markdown using turndown */
export function convertToMarkdown(html: string): string {
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});

	const preserveCodeBlocks = (node: { nodeName: string; querySelector: (sel: string) => Element | null }): boolean => {
		return node.nodeName === "PRE" && !!node.querySelector("code");
	};

	const replaceContent = (content: string): string => content;
	td.addRule("preserveCodeBlocks", {
		filter: preserveCodeBlocks,
		replacement: replaceContent,
	});
	return td.turndown(html);
}

/**
 * Try to fetch URL using browser rendering (agent-browser)
 */
function tryBrowserFetch(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000
): { text: string; warning?: string } | null {
	if (!isBrowserAvailable()) {
		return { text: '', warning: 'agent-browser not installed. Install with: npm i -g agent-browser && agent-browser install' };
	}

	try {
		execFileSync('agent-browser', ['open', url], {
			encoding: 'utf-8',
			stdio: 'pipe',
			timeout,
		});

		execFileSync('agent-browser', ['wait', '--load', waitFor], {
			encoding: 'utf-8',
			stdio: 'pipe',
			timeout,
		});

		let text = '';
		let contentSource = 'body';

		// Try article first
		try {
			const articleText = execFileSync('agent-browser', ['get', 'text', 'article'], {
				encoding: 'utf-8',
				stdio: 'pipe',
				timeout: 5000,
			});
			if (articleText && articleText.trim().length > 100) {
				text = articleText;
				contentSource = 'article';
			}
		} catch {
			// Continue
		}

		// Try main
		if (!text) {
			try {
				const mainText = execFileSync('agent-browser', ['get', 'text', 'main'], {
					encoding: 'utf-8',
					stdio: 'pipe',
					timeout: 5000,
				});
				if (mainText && mainText.trim().length > 100) {
					text = mainText;
					contentSource = 'main';
				}
			} catch {
				// Continue
			}
		}

		// Fallback to body
		if (!text || text.trim().length < 100) {
			text = execFileSync('agent-browser', ['get', 'text', 'body'], {
				encoding: 'utf-8',
				stdio: 'pipe',
				timeout,
			});
			contentSource = 'body';
		}

		try {
			execFileSync('agent-browser', ['close'], { encoding: 'utf-8', stdio: 'pipe' });
		} catch {
			// Ignore close errors
		}

		return {
			text,
			warning: contentSource === 'body' ? 'Content extracted from body (article/main not found)' : undefined,
		};
	} catch (error) {
		try {
			execFileSync('agent-browser', ['close'], { encoding: 'utf-8', stdio: 'pipe' });
		} catch {
			// Ignore
		}

		const message = error instanceof Error ? error.message : String(error);
		return { text: '', warning: `agent-browser failed: ${message}` };
	}
}

/**
 * Get content-type header via HEAD request (with GET fallback)
 * Returns null if unable to determine
 */
async function probeContentType(
	url: string,
	fetchFn: typeof fetch
): Promise<string | null> {
	try {
		const response = await fetchFn(url, {
			method: 'HEAD',
			headers: { "User-Agent": "pi-webfetch/1.0" },
		});
		return response.headers.get("content-type");
	} catch {
		// HEAD might not be supported, try GET without body
		try {
			const response = await fetchFn(url, {
				method: 'GET',
				headers: { "User-Agent": "pi-webfetch/1.0" },
			});
			return response.headers.get("content-type");
		} catch {
			return null;
		}
	}
}

/**
 * Main fetch function - probes content-type first, then uses appropriate method
 */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	maxMarkdownSize: number = MAX_MARKDOWN_SIZE
): Promise<FetchResult> {
	let details: WebfetchDetails;

	const { rawUrl, isGitHubRaw } = convertGitHubToRaw(url);
	const fetchUrl = isGitHubRaw ? rawUrl : url;

	// For HTML pages, try browser first
	let browserWarning: string | undefined;

	// Determine if we should skip browser for this URL
	const skipBrowser =
		isGitHubRaw ||
		isLikelyBinaryUrl(url) ||
		isBinaryContentType(await probeContentType(fetchUrl, fetchFn));

	if (!skipBrowser) {
		const browserResult = tryBrowserFetch(url);
		if (browserResult && browserResult.text) {
			const text = browserResult.text;
			const originalSize = Buffer.byteLength(text, 'utf-8');
			const truncated = Buffer.byteLength(text, 'utf-8') > maxMarkdownSize;
			const finalText = truncateToSize(text, maxMarkdownSize);

			details = {
				url,
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa',
				originalSize,
				tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
				truncated,
				extracted: true,
				browserWarning: browserResult.warning,
			};

			return {
				content: [{ type: "text", text: buildFetchHeader(details) + finalText }],
				details,
			};
		}
		browserWarning = browserResult?.warning;
	}

	// Static HTTP fetch
	let response: Response;
	try {
		response = await fetchFn(fetchUrl, {
			headers: {
				"User-Agent": "pi-webfetch/1.0",
				Accept: isGitHubRaw ? "text/plain,text/markdown,text/*,*/*" : "text/html,text/plain,application/xml,application/json,*/*",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		details = { url, contentType: null, status: 0, processedAs: "error", browserWarning };
		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `Failed to fetch ${url}: ${message}` }],
			details,
		};
	}

	const contentType = response.headers.get("content-type");
	const status = response.status;

	if (!response.ok) {
		details = { url, contentType, status, processedAs: "error", browserWarning };
		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `HTTP ${status} for ${url}` }],
			details,
		};
	}

	// GitHub raw or plain text - use as-is
	if (isGitHubRaw || contentType?.includes("text/plain") || contentType?.includes("text/markdown")) {
		try {
			const text = await response.text();
			const originalSize = Buffer.byteLength(text, 'utf-8');
			const truncated = Buffer.byteLength(text, 'utf-8') > maxMarkdownSize;
			const finalText = truncateToSize(text, maxMarkdownSize);

			details = {
				url,
				contentType: isGitHubRaw ? "text/plain" : contentType,
				status,
				processedAs: "markdown",
				originalSize,
				tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
				truncated,
				browserWarning,
			};

			return {
				content: [{ type: "text", text: buildFetchHeader(details) + finalText }],
				details,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			details = { url, contentType, status, processedAs: "error", browserWarning };
			return {
				content: [{ type: "text", text: buildFetchHeader(details) + `Failed to process ${url}: ${message}` }],
				details,
			};
		}
	}

	// HTML - static extraction fallback
	if (contentType?.includes("text/html")) {
		try {
			const html = await response.text();
			const originalSize = Buffer.byteLength(html, "utf-8");
			const { content: extractedHtml, extracted } = extractMainContent(html);
			let markdown = convertToMarkdown(extractedHtml);
			const truncated = Buffer.byteLength(markdown, 'utf-8') > maxMarkdownSize;
			markdown = truncateToSize(markdown, maxMarkdownSize);

			details = {
				url,
				contentType,
				status,
				processedAs: "fallback",
				originalSize,
				tempFileSize: Buffer.byteLength(markdown, 'utf-8'),
				truncated,
				extracted,
				browserWarning: browserWarning || "Using static fetch (browser rendering not available or failed)",
			};

			return {
				content: [{ type: "text", text: buildFetchHeader(details) + markdown }],
				details,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			details = { url, contentType, status, processedAs: "error", browserWarning };
			return {
				content: [{ type: "text", text: buildFetchHeader(details) + `Failed to process ${url}: ${message}` }],
				details,
			};
		}
	}

	// Binary content - download to temp file
	try {
		const buffer = await response.arrayBuffer();
		const data = Buffer.from(buffer);
		const size = data.byteLength;
		const extension = getExtensionFromContentType(contentType, url);
		const tempPath = getTempFilePath("webfetch", extension);

		const fs = await import("node:fs");
		fs.writeFileSync(tempPath, data);

		details = { url, contentType, status, processedAs: "binary", tempFileSize: size, browserWarning };

		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `Downloaded binary file to: ${tempPath}\nSize: ${formatBytes(size)}, Content-Type: ${contentType || "unknown"}` }],
			details,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		details = { url, contentType, status, processedAs: "error", browserWarning };
		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `Failed to download ${url}: ${message}` }],
			details,
		};
	}
}

/**
 * Explicit browser-based fetch for SPA pages
 */
export async function fetchUrlWithBrowser(
	url: string,
	waitFor: string = 'networkidle',
	timeout: number = 30000
): Promise<FetchResult> {
	const browserResult = tryBrowserFetch(url, waitFor, timeout);

	if (browserResult && browserResult.text) {
		const text = browserResult.text;
		const originalSize = Buffer.byteLength(text, 'utf-8');
		const truncated = Buffer.byteLength(text, 'utf-8') > MAX_MARKDOWN_SIZE;
		const finalText = truncateToSize(text, MAX_MARKDOWN_SIZE);

		const details: WebfetchDetails = {
			url,
			contentType: 'text/html',
			status: 200,
			processedAs: 'spa',
			originalSize,
			tempFileSize: Buffer.byteLength(finalText, 'utf-8'),
			truncated,
			extracted: true,
			browserWarning: browserResult.warning,
		};

		return {
			content: [{ type: "text", text: buildFetchHeader(details) + finalText }],
			details,
		};
	}

	const warning = browserResult?.warning || 'Unknown browser error';
	const details: WebfetchDetails = {
		url,
		contentType: 'text/html',
		status: 200,
		processedAs: 'error',
		browserWarning: warning,
	};

	return {
		content: [{
			type: "text",
			text: buildFetchHeader(details) +
				`Browser rendering failed.\n\n${warning}\n\n` +
				'Install agent-browser: npm i -g agent-browser && agent-browser install'
		}],
		details,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description:
			"Fetch a remote URL and process its content. " +
			"Uses browser rendering (agent-browser) for HTML pages when available. " +
			"Falls back to static fetch with warning if browser is unavailable. " +
			"Binary files are downloaded to temp directory.",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch" }),
		}),

		async execute(_toolCallId, params, _signal) {
			const { url } = params;
			return fetchUrl(url, fetch, MAX_MARKDOWN_SIZE);
		},
	});

	pi.registerTool({
		name: "webfetch-spa",
		label: "Web Fetch (SPA)",
		description:
			"Explicitly fetch using browser rendering (agent-browser). " +
			"For JavaScript-heavy pages like Reddit, Google Support, Twitter/X, Notion, etc. " +
			"Requires: npm i -g agent-browser && agent-browser install",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch" }),
			waitFor: Type.Optional(
				Type.Union([
					Type.Literal("networkidle"),
					Type.Literal("domcontentloaded"),
				])
			),
			timeout: Type.Optional(Type.Number()),
		}),

		async execute(_toolCallId, params, _signal) {
			const { url, waitFor = "networkidle", timeout = 30000 } = params;
			return fetchUrlWithBrowser(url, waitFor, timeout);
		},
	});
}
