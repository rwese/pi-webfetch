import { describe, it, expect, vi } from "vitest";
import {
	isTextContentType,
	isBinaryContentType,
	getExtensionFromContentType,
	truncateToSize,
	convertToMarkdown,
	convertGitHubToRaw,
	extractMainContent,
	isBrowserAvailable,
	MAX_MARKDOWN_SIZE,
	isLikelyBinaryUrl,
} from "../extensions/index";

describe("isTextContentType", () => {
	it("returns true for text/html", () => {
		expect(isTextContentType("text/html")).toBe(true);
		expect(isTextContentType("text/html; charset=utf-8")).toBe(true);
	});

	it("returns true for text/plain", () => {
		expect(isTextContentType("text/plain")).toBe(true);
	});

	it("returns true for application/xml", () => {
		expect(isTextContentType("application/xml")).toBe(true);
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

	it("returns jpg for image/jpeg", () => {
		expect(getExtensionFromContentType("image/jpeg", "")).toBe("jpg");
	});

	it("returns svg for image/svg+xml", () => {
		expect(getExtensionFromContentType("image/svg+xml", "")).toBe("svg");
	});

	it("falls back to URL extension when content type is null", () => {
		expect(getExtensionFromContentType(null, "https://example.com/file.pdf")).toBe("pdf");
	});

	it("returns bin when URL has no extension", () => {
		expect(getExtensionFromContentType(null, "https://example.com/")).toBe("bin");
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
});

describe("convertGitHubToRaw", () => {
	it("converts github blob URL to raw", () => {
		const result = convertGitHubToRaw(
			"https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md"
		);
		expect(result.rawUrl).toBe(
			"https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md"
		);
		expect(result.isGitHubRaw).toBe(true);
	});

	it("handles branch with slashes", () => {
		const result = convertGitHubToRaw(
			"https://github.com/user/repo/blob/feature/test/file.txt"
		);
		expect(result.rawUrl).toBe(
			"https://raw.githubusercontent.com/user/repo/feature/test/file.txt"
		);
	});

	it("returns original URL for non-GitHub URLs", () => {
		const result = convertGitHubToRaw("https://example.com/page");
		expect(result.rawUrl).toBe("https://example.com/page");
		expect(result.isGitHubRaw).toBe(false);
	});

	it("returns original URL for non-blob GitHub URLs", () => {
		const result = convertGitHubToRaw("https://github.com/user/repo");
		expect(result.rawUrl).toBe("https://github.com/user/repo");
		expect(result.isGitHubRaw).toBe(false);
	});
});

describe("extractMainContent", () => {
	it("extracts article content", () => {
		const html = `<html><body><nav>Nav</nav><article><h1>Title</h1><p>Main</p></article><footer>Footer</footer></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain("<h1>Title</h1>");
	});

	it("extracts main element", () => {
		const html = `<html><body><header>Header</header><main><p>Main content</p></main></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain("Main content");
	});

	it("extracts markdown-body class (GitHub style)", () => {
		const html = `<html><body><div class="header">Header</div><div class="markdown-body"><p>Readme</p></div></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain("Readme");
	});

	it("falls back to body when no main content found", () => {
		const html = `<html><body><p>Some content</p></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain("Some content");
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
		const html = "<h1>H1</h1><h2>H2</h2>";
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain("# H1");
		expect(markdown).toContain("## H2");
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

describe("isBrowserAvailable", () => {
	it("checks for agent-browser availability", () => {
		const result = isBrowserAvailable();
		expect(typeof result).toBe("boolean");
	});
});

describe("MAX_MARKDOWN_SIZE", () => {
	it("is 100KB", () => {
		expect(MAX_MARKDOWN_SIZE).toBe(100 * 1024);
	});
});

describe("isLikelyBinaryUrl", () => {
	it("returns true for PDF URLs", () => {
		expect(isLikelyBinaryUrl("https://example.com/file.pdf")).toBe(true);
		expect(isLikelyBinaryUrl("https://example.com/file.PDF")).toBe(true);
	});

	it("returns true for ZIP URLs", () => {
		expect(isLikelyBinaryUrl("https://example.com/archive.zip")).toBe(true);
	});

	it("returns true for image URLs", () => {
		expect(isLikelyBinaryUrl("https://example.com/image.png")).toBe(true);
		expect(isLikelyBinaryUrl("https://example.com/image.jpg")).toBe(true);
		expect(isLikelyBinaryUrl("https://example.com/image.gif")).toBe(true);
	});

	it("returns true for video/audio URLs", () => {
		expect(isLikelyBinaryUrl("https://example.com/video.mp4")).toBe(true);
		expect(isLikelyBinaryUrl("https://example.com/audio.mp3")).toBe(true);
	});

	it("returns false for HTML URLs", () => {
		expect(isLikelyBinaryUrl("https://example.com/page.html")).toBe(false);
		expect(isLikelyBinaryUrl("https://example.com/page")).toBe(false);
	});

	it("returns false for text URLs", () => {
		expect(isLikelyBinaryUrl("https://example.com/readme.md")).toBe(false);
		expect(isLikelyBinaryUrl("https://example.com/data.json")).toBe(false);
	});

	it("handles URLs with query parameters", () => {
		expect(isLikelyBinaryUrl("https://example.com/file.pdf?token=abc")).toBe(true);
	});
});
