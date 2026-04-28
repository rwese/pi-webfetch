import { describe, it, expect, vi } from 'vitest';
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
	removeMarkdownAnchors,
	extractEmbeddedImages,
	stripEmbeddedImages,
} from '../extensions/index';

describe('isTextContentType', () => {
	it('returns true for text/html', () => {
		expect(isTextContentType('text/html')).toBe(true);
		expect(isTextContentType('text/html; charset=utf-8')).toBe(true);
	});

	it('returns true for text/plain', () => {
		expect(isTextContentType('text/plain')).toBe(true);
	});

	it('returns true for application/xml', () => {
		expect(isTextContentType('application/xml')).toBe(true);
	});

	it('returns false for null', () => {
		expect(isTextContentType(null)).toBe(false);
	});

	it('returns false for binary types', () => {
		expect(isTextContentType('image/png')).toBe(false);
		expect(isTextContentType('application/pdf')).toBe(false);
	});
});

describe('isBinaryContentType', () => {
	it('returns true for unknown content type', () => {
		expect(isBinaryContentType(null)).toBe(true);
	});

	it('returns false for text types', () => {
		expect(isBinaryContentType('text/html')).toBe(false);
		expect(isBinaryContentType('text/plain')).toBe(false);
	});

	it('returns false for application/json', () => {
		expect(isBinaryContentType('application/json')).toBe(false);
	});

	it('returns true for image types', () => {
		expect(isBinaryContentType('image/jpeg')).toBe(true);
		expect(isBinaryContentType('image/png')).toBe(true);
	});
});

describe('getExtensionFromContentType', () => {
	it('returns html for text/html', () => {
		expect(getExtensionFromContentType('text/html', '')).toBe('html');
	});

	it('returns txt for text/plain', () => {
		expect(getExtensionFromContentType('text/plain', '')).toBe('txt');
	});

	it('returns jpg for image/jpeg', () => {
		expect(getExtensionFromContentType('image/jpeg', '')).toBe('jpg');
	});

	it('returns svg for image/svg+xml', () => {
		expect(getExtensionFromContentType('image/svg+xml', '')).toBe('svg');
	});

	it('falls back to URL extension when content type is null', () => {
		expect(getExtensionFromContentType(null, 'https://example.com/file.pdf')).toBe('pdf');
	});

	it('returns bin when URL has no extension', () => {
		expect(getExtensionFromContentType(null, 'https://example.com/')).toBe('bin');
	});
});

describe('truncateToSize', () => {
	it('returns original text if under max size', () => {
		const text = 'Hello, World!';
		expect(truncateToSize(text, 100)).toBe('Hello, World!');
	});

	it('truncates text at max size with ellipsis', () => {
		const text = 'This is a very long string that needs truncating';
		const maxSize = 20;
		const result = truncateToSize(text, maxSize);
		expect(result.length).toBe(maxSize);
		expect(result.endsWith('...')).toBe(true);
	});
});

describe('convertGitHubToRaw', () => {
	it('converts github blob URL to raw', () => {
		const result = convertGitHubToRaw(
			'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md',
		);
		expect(result.rawUrl).toBe(
			'https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md',
		);
		expect(result.isGitHubRaw).toBe(true);
	});

	it('handles branch with slashes', () => {
		const result = convertGitHubToRaw(
			'https://github.com/user/repo/blob/feature/test/file.txt',
		);
		expect(result.rawUrl).toBe(
			'https://raw.githubusercontent.com/user/repo/feature/test/file.txt',
		);
	});

	it('returns original URL for non-GitHub URLs', () => {
		const result = convertGitHubToRaw('https://example.com/page');
		expect(result.rawUrl).toBe('https://example.com/page');
		expect(result.isGitHubRaw).toBe(false);
	});

	it('returns original URL for non-blob GitHub URLs', () => {
		const result = convertGitHubToRaw('https://github.com/user/repo');
		expect(result.rawUrl).toBe('https://github.com/user/repo');
		expect(result.isGitHubRaw).toBe(false);
	});
});

describe('extractMainContent', () => {
	it('extracts article content', () => {
		const html = `<html><body><nav>Nav</nav><article><h1>Title</h1><p>Main</p></article><footer>Footer</footer></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain('<h1>Title</h1>');
	});

	it('extracts main element', () => {
		const html = `<html><body><header>Header</header><main><p>Main content</p></main></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain('Main content');
	});

	it('extracts markdown-body class (GitHub style)', () => {
		const html = `<html><body><div class="header">Header</div><div class="markdown-body"><p>Readme</p></div></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain('Readme');
	});

	it('falls back to body when no main content found', () => {
		const html = `<html><body><p>Some content</p></body></html>`;
		const result = extractMainContent(html);
		expect(result.extracted).toBe(true);
		expect(result.content).toContain('Some content');
	});
});

describe('convertToMarkdown', () => {
	it('converts simple HTML to markdown', () => {
		const html = '<h1>Title</h1><p>Paragraph</p>';
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain('# Title');
		expect(markdown).toContain('Paragraph');
	});

	it('converts headings correctly', () => {
		const html = '<h1>H1</h1><h2>H2</h2>';
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain('# H1');
		expect(markdown).toContain('## H2');
	});

	it('preserves code blocks in pre tags', () => {
		const html = '<pre><code>const x = 1;</code></pre>';
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain('const x = 1;');
	});

	it('converts links to markdown', () => {
		const html = '<a href="https://example.com">Example</a>';
		const markdown = convertToMarkdown(html);
		expect(markdown).toContain('[Example](https://example.com)');
	});

	it('handles empty string', () => {
		expect(convertToMarkdown('')).toBe('');
	});

	it('removes markdown anchor links from generated content', () => {
		const html = '<h2 id="license">License</h2><p>MIT License</p>';
		const markdown = convertToMarkdown(html);
		expect(markdown).not.toContain('[](#license)');
	});
});

describe('removeMarkdownAnchors', () => {
	it('removes anchor links like [](#license)', () => {
		const markdown = 'Some text [](#license) more text';
		expect(removeMarkdownAnchors(markdown)).toBe('Some text  more text');
	});

	it('removes anchor links with titles like [](#anchor "title")', () => {
		const markdown = 'Text [](#section "Section") more';
		expect(removeMarkdownAnchors(markdown)).toBe('Text  more');
	});

	it('handles multiple anchor links', () => {
		const markdown = '[](#a) [](#b) [](#c)';
		expect(removeMarkdownAnchors(markdown)).toBe('  ');
	});

	it('preserves normal links', () => {
		const markdown = '[Link](https://example.com) [](#anchor) [Another](#path)';
		expect(removeMarkdownAnchors(markdown)).toBe(
			'[Link](https://example.com)  [Another](#path)',
		);
	});

	it('returns original string when no anchors', () => {
		const markdown = 'Normal text with no anchors';
		expect(removeMarkdownAnchors(markdown)).toBe('Normal text with no anchors');
	});

	it('handles empty string', () => {
		expect(removeMarkdownAnchors('')).toBe('');
	});
});

describe('stripEmbeddedImages', () => {
	it('removes image syntax but keeps alt text', () => {
		const markdown = 'Some text ![alt text](https://example.com/image.png) more';
		expect(stripEmbeddedImages(markdown)).toBe('Some text alt text more');
	});

	it('handles images without alt text', () => {
		const markdown = 'Text ![](https://example.com/img.jpg) here';
		expect(stripEmbeddedImages(markdown)).toBe('Text  here');
	});

	it('handles images with titles', () => {
		const markdown = '![logo](https://example.com/logo.png "Logo Title")';
		expect(stripEmbeddedImages(markdown)).toBe('logo');
	});

	it('handles multiple images', () => {
		const markdown = '![img1](url1) text ![img2](url2)';
		expect(stripEmbeddedImages(markdown)).toBe('img1 text img2');
	});

	it('preserves regular text', () => {
		const markdown = 'No images here, just text';
		expect(stripEmbeddedImages(markdown)).toBe('No images here, just text');
	});

	it('handles empty string', () => {
		expect(stripEmbeddedImages('')).toBe('');
	});
});

describe('extractEmbeddedImages', () => {
	it('returns original content when no images', async () => {
		const markdown = 'No images here';
		const result = await extractEmbeddedImages(markdown);
		expect(result.content).toBe(markdown);
		expect(result.tempFilePath).toBeUndefined();
	});

	it('replaces single image with reference', async () => {
		const markdown = 'Text ![alt](https://example.com/img.png) more';
		const result = await extractEmbeddedImages(markdown);
		expect(result.content).toContain('![alt][ref-1]');
		expect(result.content).not.toContain('![alt](https://example.com/img.png)');
	});

	it('replaces multiple images with numbered references', async () => {
		const markdown = '![a](url1) text ![b](url2) text ![c](url3)';
		const result = await extractEmbeddedImages(markdown);
		expect(result.content).toContain('![a][ref-1]');
		expect(result.content).toContain('![b][ref-2]');
		expect(result.content).toContain('![c][ref-3]');
		expect(result.tempFilePath).toBeDefined();
	});

	it('uses default alt text when none provided', async () => {
		const markdown = 'Text ![](https://example.com/img.png) more';
		const result = await extractEmbeddedImages(markdown);
		expect(result.content).toContain('![Image1][ref-1]');
	});

	it('creates temp file with references', async () => {
		const markdown = '![logo](https://example.com/logo.png "Company Logo")';
		const result = await extractEmbeddedImages(markdown);
		expect(result.tempFilePath).toBeDefined();
		expect(result.tempFilePath).toContain('webfetch-images');
	});
});

describe('isBrowserAvailable', () => {
	it('checks for agent-browser availability', () => {
		const result = isBrowserAvailable();
		expect(typeof result).toBe('boolean');
	});
});

describe('MAX_MARKDOWN_SIZE', () => {
	it('is 100KB', () => {
		expect(MAX_MARKDOWN_SIZE).toBe(100 * 1024);
	});
});

describe('isLikelyBinaryUrl', () => {
	it('returns true for PDF URLs', () => {
		expect(isLikelyBinaryUrl('https://example.com/file.pdf')).toBe(true);
		expect(isLikelyBinaryUrl('https://example.com/file.PDF')).toBe(true);
	});

	it('returns true for ZIP URLs', () => {
		expect(isLikelyBinaryUrl('https://example.com/archive.zip')).toBe(true);
	});

	it('returns true for image URLs', () => {
		expect(isLikelyBinaryUrl('https://example.com/image.png')).toBe(true);
		expect(isLikelyBinaryUrl('https://example.com/image.jpg')).toBe(true);
		expect(isLikelyBinaryUrl('https://example.com/image.gif')).toBe(true);
	});

	it('returns true for video/audio URLs', () => {
		expect(isLikelyBinaryUrl('https://example.com/video.mp4')).toBe(true);
		expect(isLikelyBinaryUrl('https://example.com/audio.mp3')).toBe(true);
	});

	it('returns false for HTML URLs', () => {
		expect(isLikelyBinaryUrl('https://example.com/page.html')).toBe(false);
		expect(isLikelyBinaryUrl('https://example.com/page')).toBe(false);
	});

	it('returns false for text URLs', () => {
		expect(isLikelyBinaryUrl('https://example.com/readme.md')).toBe(false);
		expect(isLikelyBinaryUrl('https://example.com/data.json')).toBe(false);
	});

	it('handles URLs with query parameters', () => {
		expect(isLikelyBinaryUrl('https://example.com/file.pdf?token=abc')).toBe(true);
	});
});
