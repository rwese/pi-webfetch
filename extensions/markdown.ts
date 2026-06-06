// Markdown post-processing functions

import { getTempFilePath } from './helpers.js';

/**
 * Protect code blocks by replacing them with placeholders.
 * Only protects fenced code blocks (```), not inline code.
 */
function protectCodeBlocks(markdown: string): { content: string; blocks: string[] } {
	const blocks: string[] = [];
	const pattern = /```[\s\S]*?```/g;
	const matches: Array<{ start: number; end: number; block: string }> = [];

	let match;
	while ((match = pattern.exec(markdown)) !== null) {
		matches.push({ start: match.index, end: match.index + match[0].length, block: match[0] });
	}

	// Build new content with placeholders (in reverse order to preserve positions)
	let content = markdown;
	for (let i = matches.length - 1; i >= 0; i--) {
		const m = matches[i];
		blocks.unshift(m.block);
		content = content.slice(0, m.start) + `\x00CODEBLOCK_${i}\x00` + content.slice(m.end);
	}

	return { content, blocks };
}

/** Restore code blocks from placeholders */
function restoreCodeBlocks(content: string, blocks: string[]): string {
	blocks.forEach((block, idx) => {
		const placeholder = `\x00CODEBLOCK_${idx}\x00`;
		content = content.replace(placeholder, block);
	});
	return content;
}

/** Remove markdown anchor links like [](#anchor) or [text](#anchor "title") */
export function removeMarkdownAnchors(markdown: string): string {
	const { content, blocks } = protectCodeBlocks(markdown);
	// Pattern matches any markdown link where href starts with # (with optional title)
	// 1. Empty brackets with anchor: [](#anchor) or [](#anchor "title")
	// 2. Non-empty brackets with anchor AND title: [text](#anchor "title")
	const cleaned = content.replace(
		/\[\]\(#[^)]+(?:\s+"[^"]*")?\)|\[[^\]]*\]\(#[^)]+\s+"[^"]*"\)/g,
		'',
	);
	return restoreCodeBlocks(cleaned, blocks);
}
/**
 * Options for {@link extractEmbeddedImages}.
 *
 * - `extract` (default: `false`): when `true`, images are
 *   extracted to a temp file and the markdown carries
 *   `[ref-N]` placeholders (the pre-v0.9.0 behaviour). When
 *   `false` (the v0.9.0 default), inline `![alt](url)`
 *   references are preserved as-is and no temp file is
 *   written.
 */
export interface ExtractEmbeddedImagesOptions {
	extract?: boolean;
}

/**
 * Extract embedded images from markdown and (optionally) store
 * in temp file. The v0.9.0 default keeps inline `![alt](url)`
 * references intact so the markdown renders usefully in
 * downstream LLM consumers. Pass `{ extract: true }` to get
 * the pre-v0.9.0 behaviour (replaced with `[ref-N]`
 * placeholders + temp file with the full image list).
 */
export async function extractEmbeddedImages(
	markdown: string,
	options?: ExtractEmbeddedImagesOptions,
): Promise<{ content: string; tempFilePath?: string }> {
	const { content: protectedContent, blocks } = protectCodeBlocks(markdown);

	// Match inline images only (not reference-style like ![alt][ref])
	const imageRegex = /!\[([^\]]*)\]\((?!\[)([^)\s]+)(?:\s+"([^"]*)")?\)/g;
	const images: Array<{ alt: string; url: string; title?: string }> = [];

	let match;
	while ((match = imageRegex.exec(protectedContent)) !== null) {
		images.push({ alt: match[1] || '', url: match[2], title: match[3] });
	}

	if (images.length === 0) {
		return { content: restoreCodeBlocks(protectedContent, blocks) };
	}

	const extract = options?.extract === true;
	if (!extract) {
		// Default v0.9.0 path: keep inline references, no temp
		// file, no placeholder mangling. Downstream consumers
		// (LLMs, docs, etc.) can render the URL directly.
		return { content: restoreCodeBlocks(protectedContent, blocks) };
	}

	// Build URL -> ref number mapping
	const seenUrls = new Map<string, number>();
	let refCounter = 1;
	images.forEach((img) => {
		if (!seenUrls.has(img.url)) seenUrls.set(img.url, refCounter++);
	});

	// Replace images with references
	let content = protectedContent;
	seenUrls.forEach((refNum, url) => {
		const imgInfo = images.find((i) => i.url === url);
		const alt = imgInfo?.alt || `Image${refNum}`;
		const placeholder = `![${alt}][ref-${refNum}]`;
		const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = `!\\[([^\\]]*)\\]\\(${escapedUrl}\\)(?:\\s+"([^"]*)")?`;
		content = content.replace(new RegExp(pattern, 'g'), placeholder);
	});

	content = restoreCodeBlocks(content, blocks);

	// Build refs and save to temp file
	const refsContent = Array.from(seenUrls.entries())
		.map(([url, refNum]) => `[ref-${refNum}]: ${url}`)
		.join('\n');

	const tempPath = getTempFilePath('webfetch-images', 'md');
	const fs = await import('node:fs');
	fs.writeFileSync(tempPath, `${markdown}\n\n---\n\n## Image References\n\n${refsContent}\n`);

	return { content, tempFilePath: tempPath };
}

/** Remove inline images, keeping alt text. Preserves code blocks and ref-style images. */
export function stripEmbeddedImages(markdown: string): string {
	const { content, blocks } = protectCodeBlocks(markdown);
	// Match inline images with optional title (double or single quotes)
	const cleaned = content.replace(
		/!\[([^\]]*)\]\((?!\[)([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
		'$1',
	);
	return restoreCodeBlocks(cleaned, blocks);
}

/**
 * Un-escape backslash-escaped bracket pairs that turndown /
 * cheerio produced when the source HTML contained literal
 * `[` / `]` characters (e.g. inside code blocks, link text,
 * or just plain `\[1\]` footnotes). The Markdown spec says
 * `\[` and `\]` are not necessary inside prose and many
 * downstream renderers (LLMs, previews) treat them as
 * literal `[` / `]` glyphs and emit confusing output.
 *
 * Strategy:
 *
 * - `\[` / `\]` are un-escaped *only* outside of fenced code
 *   blocks. The protect / restore dance from
 *   {@link protectCodeBlocks} is reused.
 * - `\[` followed by a digit (`\[1\]`, `\[2\]`, ...) is the
 *   most common pattern (Wikipedia footnotes / citations);
 *   we un-escape that shape aggressively.
 * - `\[` followed by another `[` (a `\[` image / reference)
 *   is left alone: turndown emits `\!\[alt\](url)` and we do
 *   not want to break image syntax.
 */
export function unescapeBrackets(markdown: string): string {
	const { content, blocks } = protectCodeBlocks(markdown);
	// Un-escape \[ followed by a digit (footnote style: \[1\]).
	const cleaned = content.replace(/\\\[(\d+)\\\]/g, '[$1]');
	// Un-escape any remaining standalone \[ / \] that are not
	// preceded by `!` (i.e. not image syntax). Use a negative
	// lookbehind so `\!\[alt\](url)` round-trips intact.
	const generic = cleaned.replace(/(?<!!)\\\[/g, '[').replace(/\\\]/g, ']');
	return restoreCodeBlocks(generic, blocks);
}
