import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	isTextContentType,
	isBinaryContentType,
	getExtensionFromContentType,
	truncateToSize,
	convertToMarkdown,
	fetchUrl,
	MAX_MARKDOWN_SIZE,
} from "../extensions/index";

describe("isTextContentType", () => {
	it("returns true for text/html", () => {
		expect(isTextContentType("text/html")).toBe(true);
		expect(isTextContentType("text/html; charset=utf-8")).toBe(true);
	});

	it("returns true for text/plain", () => {
		expect(isTextContentType("text/plain")).toBe(true);
	});

	it("returns true for application/xhtml+xml", () => {
		expect(isTextContentType("application/xhtml+xml")).toBe(true);
	});

	it("returns true for application/xml", () => {
		expect(isTextContentType("application/xml")).toBe(true);
	});

	it("returns true for text/xml", () => {
		expect(isTextContentType("text/xml")).toBe(true);
	});

	it("returns false for null", () => {
		expect(isTextContentType(null)).toBe(false);
	});

	it("returns false for binary types", () => {
		expect(isTextContentType("image/png")).toBe(false);
		expect(isTextContentType("application/pdf")).toBe(false);
	});
});

describe("isBinaryContentType", () => {
	it("returns true for unknown content type", () => {
		expect(isBinaryContentType(null)).toBe(true);
	});

	it("returns false for text types", () => {
		expect(isBinaryContentType("text/html")).toBe(false);
		expect(isBinaryContentType("text/plain")).toBe(false);
	});

	it("returns false for application/json", () => {
		expect(isBinaryContentType("application/json")).toBe(false);
	});

	it("returns false for application/xml", () => {
		expect(isBinaryContentType("application/xml")).toBe(false);
	});

	it("returns true for image types", () => {
		expect(isBinaryContentType("image/jpeg")).toBe(true);
		expect(isBinaryContentType("image/png")).toBe(true);
	});
});

describe("getExtensionFromContentType", () => {
	it("returns html for text/html", () => {
		expect(getExtensionFromContentType("text/html", "")).toBe("html");
	});

	it("returns txt for text/plain", () => {
		expect(getExtensionFromContentType("text/plain", "")).toBe("txt");
	});

	it("returns css for text/css", () => {
		expect(getExtensionFromContentType("text/css", "")).toBe("css");
	});

	it("returns js for text/javascript", () => {
		expect(getExtensionFromContentType("text/javascript", "")).toBe("js");
	});

	it("returns json for application/json", () => {
		expect(getExtensionFromContentType("application/json", "")).toBe("json");
	});

	it("returns jpg for image/jpeg", () => {
		expect(getExtensionFromContentType("image/jpeg", "")).toBe("jpg");
	});

	it("returns png for image/png", () => {
		expect(getExtensionFromContentType("image/png", "")).toBe("png");
	});

	it("returns svg for image/svg+xml", () => {
		expect(getExtensionFromContentType("image/svg+xml", "")).toBe("svg");
	});

	it("returns bin for application/octet-stream", () => {
		expect(getExtensionFromContentType("application/octet-stream", "")).toBe("bin");
	});

	it("falls back to URL extension when content type is null", () => {
		expect(getExtensionFromContentType(null, "https://example.com/file.pdf")).toBe("pdf");
	});

	it("falls back to bin when URL has no extension", () => {
		// When path ends with /, pop returns empty string from split
		expect(getExtensionFromContentType(null, "https://example.com/")).toBe("bin");
	});

	it("returns bin for unknown content type", () => {
		expect(getExtensionFromContentType("application/custom", "")).toBe("bin");
	});
});

describe("truncateToSize", () => {
	it("returns original text if under max size", () => {
		const text = "Hello, World!";
		expect(truncateToSize(text, 100)).toBe("Hello, World!");
	});

	it("truncates text at max size with ellipsis", () => {
		const text = "This is a very long string that needs truncating";
		const maxSize = 20;
		const result = truncateToSize(text, maxSize);
		expect(result.length).toBe(maxSize);
		expect(result.endsWith("...")).toBe(true);
	});

	it("handles exact max size", () => {
		const text = "Exactly20Chars!------------";
		const maxSize = Buffer.byteLength(text, "utf-8");
		expect(truncateToSize(text, maxSize)).toBe(text);
	});
});

describe("convertToMarkdown", () => {
	it("converts simple HTML to markdown", () => {
		const html = "<h1>Title</h1><p>Paragraph</p>";
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain("# Title");
		expect(markdown).toContain("Paragraph");
	});

	it("converts headings correctly", () => {
		const html = "<h1>H1</h1><h2>H2</h2><h3>H3</h3>";
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain("# H1");
		expect(markdown).toContain("## H2");
		expect(markdown).toContain("### H3");
	});

	it("converts lists to markdown", () => {
		const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
		const markdown = convertToMarkdown(html);
		// Turndown uses "-   " format for list items
		expect(markdown).toContain("-   Item 1");
		expect(markdown).toContain("-   Item 2");
	});

	it("preserves code blocks in pre tags", () => {
		const html = "<pre><code>const x = 1;</code></pre>";
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain("const x = 1;");
	});

	it("converts links to markdown", () => {
		const html = '<a href="https://example.com">Example</a>';
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain("[Example](https://example.com)");
	});

	it("handles empty string", () => {
		expect(convertToMarkdown("")).toBe("");
	});
});

describe("fetchUrl", () => {
	describe("network errors", () => {
		it("handles fetch failure", async () => {
			const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
			const result = await fetchUrl("https://example.com", mockFetch);

			expect(result.details.processedAs).toBe("error");
			expect(result.content[0].text).toContain("Network error");
		});

		it("handles DNS failure", async () => {
			const mockFetch = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
			const result = await fetchUrl("https://nonexistent.invalid", mockFetch);

			expect(result.details.processedAs).toBe("error");
		});
	});

	describe("HTTP error responses", () => {
		it("handles 404 response", async () => {
			const mockResponse = {
				ok: false,
				status: 404,
				headers: { get: vi.fn().mockReturnValue("text/html") },
				text: vi.fn().mockResolvedValue("<h1>Not Found</h1>"),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com/404", mockFetch);

			expect(result.details.processedAs).toBe("error");
			expect(result.details.status).toBe(404);
		});

		it("handles 500 response", async () => {
			const mockResponse = {
				ok: false,
				status: 500,
				headers: { get: vi.fn().mockReturnValue("text/html") },
				text: vi.fn().mockResolvedValue("<h1>Server Error</h1>"),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com/500", mockFetch);

			expect(result.details.processedAs).toBe("error");
			expect(result.details.status).toBe(500);
		});
	});

	describe("HTML content", () => {
		it("converts HTML to markdown with header", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				headers: { get: vi.fn().mockReturnValue("text/html; charset=utf-8") },
				text: vi.fn().mockResolvedValue("<h1>Hello</h1><p>World</p>"),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com", mockFetch);

			expect(result.details.processedAs).toBe("markdown");
			expect(result.content[0].text).toContain("# Hello");
			expect(result.content[0].text).toContain("World");
			expect(result.content[0].text).toContain("## Fetched: https://example.com");
		});

		it("tracks original size", async () => {
			const html = "<p>Content</p>";
			const mockResponse = {
				ok: true,
				status: 200,
				headers: { get: vi.fn().mockReturnValue("text/html") },
				text: vi.fn().mockResolvedValue(html),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com", mockFetch);

			expect(result.details.originalSize).toBe(Buffer.byteLength(html, "utf-8"));
		});

		it("handles truncation for large content", async () => {
			const largeHtml = "<p>" + "x".repeat(200) + "</p>";
			const mockResponse = {
				ok: true,
				status: 200,
				headers: { get: vi.fn().mockReturnValue("text/html") },
				text: vi.fn().mockResolvedValue(largeHtml),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com", mockFetch, 50);

			expect(result.details.truncated).toBe(true);
		});
	});

	describe("plain text content", () => {
		it("returns plain text as-is with header", async () => {
			const text = "Plain text content";
			const mockResponse = {
				ok: true,
				status: 200,
				headers: { get: vi.fn().mockReturnValue("text/plain") },
				text: vi.fn().mockResolvedValue(text),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com", mockFetch);

			expect(result.details.processedAs).toBe("markdown");
			expect(result.content[0].text).toContain(text);
			expect(result.content[0].text).toContain("## Fetched: https://example.com");
		});
	});

	describe("binary content", () => {
		it("handles binary content without error", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				headers: { get: vi.fn().mockReturnValue("image/png") },
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com/image.png", mockFetch);

			expect(result.details.processedAs).toBe("binary");
			expect(result.details.tempFileSize).toBe(1024);
		});

		it("handles unknown content type as binary", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				headers: { get: vi.fn().mockReturnValue(null) },
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(512)),
			} as unknown as Response;

			const mockFetch = vi.fn().mockResolvedValue(mockResponse);
			const result = await fetchUrl("https://example.com/file", mockFetch);

			expect(result.details.processedAs).toBe("binary");
		});
	});
});