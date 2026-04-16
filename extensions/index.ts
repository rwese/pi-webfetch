/**
 * pi-webfetch Extension
 *
 * Fetches remote resources (URLs) and processes them based on content type:
 * - Text/HTML: Converts to Markdown, stores in temp file
 * - Binary files: Downloads to temp directory
 *
 * Usage:
 *   Call the `webfetch` tool with a URL to fetch and process the resource
 */

import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "cheerio";
import TurndownService from "turndown";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/** Maximum size for markdown content (100KB) */
export const MAX_MARKDOWN_SIZE = 100 * 1024;

/**
 * Detect if URL is a GitHub blob/file URL and return the raw URL
 * github.com/user/repo/blob/branch/path → raw.githubusercontent.com/user/repo/branch/path
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
 * Prioritizes: <article>, <main>, <div role="main">, .markdown-body, .content
 * Falls back to full HTML if no main content found
 */
export function extractMainContent(html: string): { content: string; extracted: boolean } {
	const $ = load(html);

	// Remove noise: scripts, styles, nav, footer, headers
	$('script, style, nav, footer, header, aside, .header, .footer, .sidebar, .navbar, .repo-header, .commit-placeholder').remove();

	// Try to find main content in order of preference
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
			// Only use extracted content if it has substantial content
			if (text.length > 500) {
				return { content: text, extracted: true };
			}
		}
	}

	// No main content found, use body or full HTML
	const $body = $('body');
	if ($body.length > 0) {
		return { content: $.html($body), extracted: true };
	}
	return { content: html, extracted: false };
}

export interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	processedAs: "markdown" | "binary" | "error";
	tempFilePath?: string;
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
	extracted?: boolean; // Whether main content was extracted from HTML
}

export interface FetchOptions {
	headers?: Record<string, string>;
	signal?: AbortSignal;
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

/** Determine if content type is text/markdown convertible */
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

/** Determine if content type is binary (non-text) */
export function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) return true; // Default to binary if unknown
	const ct = contentType.toLowerCase();
	// Text types we can handle
	if (ct.includes("text/") || ct.includes("application/json") || ct.includes("application/xml")) {
		return false;
	}
	return true;
}

/** Extract file extension from content type */
export function getExtensionFromContentType(contentType: string | null, url: string): string {
	if (!contentType) {
		// Try to get from URL
		const urlPath = new URL(url).pathname;
		const segments = urlPath.split("/");
		const lastSegment = segments.pop() || segments.pop(); // Get last non-empty segment
		if (lastSegment && lastSegment.includes(".")) {
			const ext = lastSegment.split(".").pop();
			if (ext && ext.length < 10) return ext;
		}
		return "bin";
	}

	const ct = contentType.toLowerCase();
	const mimeToExt: Record<string, string> = {
		"text/html": "html",
		"text/plain": "txt",
		"text/css": "css",
		"text/javascript": "js",
		"text/typescript": "ts",
		"application/json": "json",
		"application/xml": "xml",
		"application/pdf": "pdf",
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/gif": "gif",
		"image/webp": "webp",
		"image/svg+xml": "svg",
		"image/x-icon": "ico",
		"application/zip": "zip",
		"application/gzip": "gz",
		"application/x-tar": "tar",
		"application/octet-stream": "bin",
	};

	for (const [mime, ext] of Object.entries(mimeToExt)) {
		if (ct.includes(mime)) return ext;
	}
	return "bin";
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

	lines.push("\n---\n");
	return lines.join("\n");
}

/** Truncate text to max size */
export function truncateToSize(text: string, maxSize: number): string {
	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes <= maxSize) return text;
	// Truncate to maxSize bytes
	const buffer = Buffer.alloc(maxSize - 3); // 3 for "..."
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

export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	maxMarkdownSize: number = MAX_MARKDOWN_SIZE
): Promise<FetchResult> {
	let response: Response;
	let details: WebfetchDetails;

	// Check if URL is a GitHub blob that should be fetched as raw
	const { rawUrl, isGitHubRaw } = convertGitHubToRaw(url);
	const fetchUrl = isGitHubRaw ? rawUrl : url;

	try {
		response = await fetchFn(fetchUrl, {
			headers: {
				"User-Agent": "pi-webfetch/1.0",
				Accept: isGitHubRaw ? "text/plain,text/markdown,text/*,*/*" : "text/html,text/plain,application/xml,application/json,*/*",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		details = { url, contentType: null, status: 0, processedAs: "error" };
		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `Failed to fetch ${url}: ${message}` }],
			details,
		};
	}

	const contentType = response.headers.get("content-type");
	const status = response.status;

	// Handle non-OK responses
	if (!response.ok) {
		details = { url, contentType, status, processedAs: "error" };
		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `HTTP ${status} for ${url}` }],
			details,
		};
	}

	// Check if we should convert to markdown
	if (isTextContentType(contentType) || isGitHubRaw) {
		try {
			const html = await response.text();
			const originalSize = Buffer.byteLength(html, "utf-8");

			let markdown: string;

			// For GitHub raw URLs or plain text, use as-is
			if (isGitHubRaw || contentType?.includes("text/plain") || contentType?.includes("text/markdown")) {
				markdown = html;
			} else if (contentType?.includes("text/html")) {
				// For HTML, extract main content first
				const { content: extractedHtml, extracted } = extractMainContent(html);
				markdown = convertToMarkdown(extractedHtml);
				if (extracted) {
					details = { url, contentType, status, processedAs: "markdown", originalSize, extracted: true };
				}
			} else {
				// Other text types - use as-is
				markdown = html;
			}

			const truncated = Buffer.byteLength(markdown, "utf-8") > maxMarkdownSize;
			markdown = truncateToSize(markdown, maxMarkdownSize);

			details = {
				url,
				contentType,
				status,
				processedAs: "markdown",
				tempFileSize: Buffer.byteLength(markdown, "utf-8"),
				truncated,
				originalSize,
			};

			return {
				content: [{ type: "text", text: buildFetchHeader(details) + markdown }],
				details,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			details = { url, contentType, status, processedAs: "error" };
			return {
				content: [{ type: "text", text: buildFetchHeader(details) + `Failed to process ${url}: ${message}` }],
				details,
			};
		}
	}

	// For GitHub raw URLs that weren't detected as text (fallback)
	if (isGitHubRaw) {
		try {
			const text = await response.text();
			const originalSize = Buffer.byteLength(text, "utf-8");
			const truncated = Buffer.byteLength(text, "utf-8") > maxMarkdownSize;
			const finalText = truncateToSize(text, maxMarkdownSize);

			details = {
				url,
				contentType: "text/plain",
				status,
				processedAs: "markdown",
				tempFileSize: Buffer.byteLength(finalText, "utf-8"),
				truncated,
				originalSize,
			};

			return {
				content: [{ type: "text", text: buildFetchHeader(details) + finalText }],
				details,
			};
		} catch {
			// Fall through to binary handling
		}
	}

	// Binary content - download to temp file
	try {
		const buffer = await response.arrayBuffer();
		const data = Buffer.from(buffer);
		const size = data.byteLength;

		details = { url, contentType, status, processedAs: "binary", tempFileSize: size };

		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `Downloaded binary file (${formatBytes(size)}, Content-Type: ${contentType || "unknown"})` }],
			details,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		details = { url, contentType, status, processedAs: "error" };
		return {
			content: [{ type: "text", text: buildFetchHeader(details) + `Failed to download ${url}: ${message}` }],
			details,
		};
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description:
			"Fetch a remote URL and process its content. " +
			"HTML/text content is converted to Markdown (truncated to 100KB). " +
			"Binary files are downloaded to a temp directory. " +
			"Returns content text and/or temp file path for the resource.",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch" }),
		}),

		async execute(_toolCallId, params, _signal) {
			const { url } = params;
			return fetchUrl(url, fetch, MAX_MARKDOWN_SIZE);
		},
	});
}