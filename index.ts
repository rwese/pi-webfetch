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
import turndown from "turndown";
const { TurndownService } = turndown;
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/** Maximum size for markdown content (100KB) */
const MAX_MARKDOWN_SIZE = 100 * 1024;

/** Generate a unique temp file path */
function getTempFilePath(prefix: string, extension: string): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `${prefix}-${id}.${extension}`);
}

/** Determine if content type is text/markdown convertible */
function isTextContentType(contentType: string | null): boolean {
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
function isBinaryContentType(contentType: string | null): boolean {
	if (!contentType) return true; // Default to binary if unknown
	const ct = contentType.toLowerCase();
	// Text types we can handle
	if (ct.includes("text/") || ct.includes("application/json") || ct.includes("application/xml")) {
		return false;
	}
	return true;
}

/** Extract file extension from content type */
function getExtensionFromContentType(contentType: string | null, url: string): string {
	if (!contentType) {
		// Try to get from URL
		const urlPath = new URL(url).pathname;
		const ext = urlPath.split(".").pop();
		if (ext && ext.length < 10) return ext;
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
function truncateToSize(text: string, maxSize: number): string {
	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes <= maxSize) return text;
	// Truncate to maxSize bytes
	const buffer = Buffer.alloc(maxSize - 3); // 3 for "..."
	buffer.write(text, 0, "utf-8");
	return buffer.toString("utf-8") + "...";
}

interface WebfetchDetails {
	url: string;
	contentType: string | null;
	status: number;
	processedAs: "markdown" | "binary" | "error";
	tempFilePath?: string;
	tempFileSize?: number;
	truncated?: boolean;
	originalSize?: number;
}

/** Convert HTML to Markdown using turndown */
async function convertToMarkdown(html: string): Promise<string> {
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});
	// Add custom rules for better handling
	td.addRule("preserveCodeBlocks", {
		filter: (node) => node.nodeName === "PRE" && node.querySelector("code"),
		replacement: (content) => content,
	});
	return td.turndown(html);
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

			let response: Response;
			try {
				response = await fetch(url, {
					signal,
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
					} as WebfetchDetails,
				};
			}

			const contentType = response.headers.get("content-type");
			const status = response.status;

			// Handle non-OK responses
			if (!response.ok) {
				return {
					content: [
						{
							type: "text",
							text: `HTTP ${status} for ${url}`,
						},
					],
					details: {
						url,
						contentType,
						status,
						processedAs: "error",
					} as WebfetchDetails,
				};
			}

			// Check if we should convert to markdown
			if (isTextContentType(contentType)) {
				try {
					const html = await response.text();
					const originalSize = Buffer.byteLength(html, "utf-8");

					let markdown: string;
					if (contentType?.includes("text/html")) {
						markdown = await convertToMarkdown(html);
					} else {
						// Plain text - use as-is
						markdown = html;
					}

					const truncated = Buffer.byteLength(markdown, "utf-8") > MAX_MARKDOWN_SIZE;
					markdown = truncateToSize(markdown, MAX_MARKDOWN_SIZE);

					// Write to temp file
					const ext = contentType?.includes("html") ? "md" : "txt";
					const tempPath = getTempFilePath("webfetch", ext);
					await writeFile(tempPath, markdown, "utf-8");

					return {
						content: [
							{
								type: "text",
								text: markdown,
							},
						],
						details: {
							url,
							contentType,
							status,
							processedAs: "markdown" as const,
							tempFilePath: tempPath,
							tempFileSize: Buffer.byteLength(markdown, "utf-8"),
							truncated,
							originalSize,
						} as WebfetchDetails,
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
						} as WebfetchDetails,
					};
				}
			}

			// Binary content - download to temp file
			try {
				const buffer = await response.arrayBuffer();
				const data = Buffer.from(buffer);
				const ext = getExtensionFromContentType(contentType, url);
				const tempPath = getTempFilePath("webfetch", ext);

				await writeFile(tempPath, data);

				return {
					content: [
						{
							type: "text",
							text: `Downloaded binary file to: ${tempPath} (${data.byteLength} bytes, Content-Type: ${contentType || "unknown"})`,
						},
					],
					details: {
						url,
						contentType,
						status,
						processedAs: "binary" as const,
						tempFilePath: tempPath,
						tempFileSize: data.byteLength,
					} as WebfetchDetails,
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
					} as WebfetchDetails,
				};
			}
		},
	});
}
