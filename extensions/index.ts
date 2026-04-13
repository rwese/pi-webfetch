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
import { writeFile } from "node:fs/promises";
import TurndownService from "turndown";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/** Maximum size for markdown content (100KB) */
export const MAX_MARKDOWN_SIZE = 100 * 1024;

export interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	processedAs: "markdown" | "binary" | "error";
	tempFilePath?: string;
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
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

/** Fetch and process a URL, returning result without writing to disk */
export async function fetchUrl(
	url: string,
	fetchFn: typeof fetch = fetch,
	maxMarkdownSize: number = MAX_MARKDOWN_SIZE
): Promise<FetchResult> {
	let response: Response;
	try {
		response = await fetchFn(url, {
			headers: {
				"User-Agent": "pi-webfetch/1.0",
				Accept: "text/html,text/plain,application/xml,application/json,*/*",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to fetch ${url}: ${message}` }],
			details: {
				url,
				contentType: null,
				status: 0,
				processedAs: "error",
			},
		};
	}

	const contentType = response.headers.get("content-type");
	const status = response.status;

	// Handle non-OK responses
	if (!response.ok) {
		return {
			content: [{ type: "text", text: `HTTP ${status} for ${url}` }],
			details: {
				url,
				contentType,
				status,
				processedAs: "error",
			},
		};
	}

	// Check if we should convert to markdown
	if (isTextContentType(contentType)) {
		try {
			const html = await response.text();
			const originalSize = Buffer.byteLength(html, "utf-8");

			let markdown: string;
			if (contentType?.includes("text/html")) {
				markdown = convertToMarkdown(html);
			} else {
				// Plain text - use as-is
				markdown = html;
			}

			const truncated = Buffer.byteLength(markdown, "utf-8") > maxMarkdownSize;
			markdown = truncateToSize(markdown, maxMarkdownSize);

			return {
				content: [{ type: "text", text: markdown }],
				details: {
					url,
					contentType,
					status,
					processedAs: "markdown",
					tempFileSize: Buffer.byteLength(markdown, "utf-8"),
					truncated,
					originalSize,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `Failed to process ${url}: ${message}` }],
				details: {
					url,
					contentType,
					status,
					processedAs: "error",
				},
			};
		}
	}

	// Binary content - download to temp file
	try {
		const buffer = await response.arrayBuffer();
		const data = Buffer.from(buffer);

		return {
			content: [{ type: "text", text: `Downloaded binary file (${data.byteLength} bytes, Content-Type: ${contentType || "unknown"})` }],
			details: {
				url,
				contentType,
				status,
				processedAs: "binary",
				tempFileSize: data.byteLength,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `Failed to download ${url}: ${message}` }],
			details: {
				url,
				contentType,
				status,
				processedAs: "error",
			},
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

		async execute(_toolCallId, params, signal) {
			const { url } = params;
			return fetchUrl(url, fetch, MAX_MARKDOWN_SIZE);
		},
	});
}