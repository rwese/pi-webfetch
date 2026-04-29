// HTML extraction and conversion utilities

import { load } from 'cheerio';
import TurndownService from 'turndown';

/** Common elements to remove from HTML */
const REMOVE_SELECTORS = [
	// Script and style elements
	'script',
	'style',
	// Navigation and layout
	'nav',
	'header',
	'footer',
	'aside',
	// Common navigation classes
	'.header',
	'.footer',
	'.sidebar',
	'.navbar',
	'.nav',
	'.navigation',
	'.menu',
	'.dropdown',
	// GitHub-specific elements
	'.Header',
	'.HeaderMenu',
	'.Footer',
	'.AppHeader',
	'.AppFooter',
	'.repository-layout-sidebar',
	// Social/interactive elements
	'.social-share',
	'.share-buttons',
	'.comments',
	'#comments',
	// Cookie/consent banners
	'.cookie-banner',
	'.consent-banner',
	'.gdpr',
];

/** GitHub-specific selectors for main content */
const GITHUB_CONTENT_SELECTORS = [
	'article', // Issue/PR content
	'main', // Main content area
	'[role="main"]', // ARIA main
	'.markdown-body', // GitHub markdown content
	'.file-content', // File viewer
	'.Box-body', // GitHub box content
	'.repository-content', // Repository main content
	'#repo-content-turbo-frame', // React rendered content
];

/**
 * Clean HTML by removing unwanted elements
 */
function cleanHtml(html: string): string {
	if (!html) return '';

	try {
		const $ = load(html);

		// Remove unwanted elements
		for (const selector of REMOVE_SELECTORS) {
			$(selector).remove();
		}

		// Remove HTML comments (often contain embedded data)
		$.root()
			.contents()
			.filter((_, node) => node.type === 'comment')
			.remove();

		// Remove script tags with JSON data (application/json)
		$('script[type="application/json"]').remove();
		$('script[data-component="layout"]').remove();

		// Remove noscript content
		$('noscript').remove();

		// Remove data attributes with large content
		$('[data-data]').remove();
		$('[data-payload]').remove();

		// Get cleaned HTML - extract body content to avoid wrapper tags
		const body = $('body');
		if (body.length > 0) {
			return (
				body.html() || $('body').contents().not('script, style').parent().html() || $.html()
			);
		}
		return $.html();
	} catch {
		// Fallback: basic regex-based cleaning
		return basicClean(html);
	}
}

/**
 * Basic regex-based HTML cleaning (fallback if cheerio fails)
 */
function basicClean(html: string): string {
	let cleaned = html;

	// Remove script tags
	cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');

	// Remove style tags
	cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

	// Remove HTML comments
	cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

	// Remove common navigation elements
	cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, '');
	cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, '');
	cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, '');

	return cleaned;
}

/**
 * Extract main content from HTML using common selectors
 */
export function extractMainContent(html: string): { content: string; extracted: boolean } {
	if (!html) return { content: '', extracted: false };

	// Check if this is a GitHub page
	const isGitHub = html.includes('github.com') || html.includes('data-color-mode');
	const selectors = isGitHub
		? [
				...GITHUB_CONTENT_SELECTORS,
				'article',
				'main',
				'[role="main"]',
				'.markdown-body',
				'.file-content',
				'.content',
				'.post-content',
				'.article-content',
				'#content',
				'#main-content',
				'.documentation',
			]
		: [
				'article',
				'main',
				'[role="main"]',
				'.markdown-body',
				'.file-content',
				'.content',
				'.post-content',
				'.article-content',
				'#content',
				'#main-content',
				'.documentation',
			];

	// Try each selector
	for (const selector of selectors) {
		const match = html.match(new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, 'i'));
		if (match && match[1].length > 200) {
			return { content: match[1].trim(), extracted: true };
		}
	}

	// Try extracting from body
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (bodyMatch) {
		return { content: bodyMatch[1].trim(), extracted: true };
	}

	return { content: html, extracted: false };
}

/** Detect if HTML is likely a SPA (Single Page Application) */
export function detectLikelySPA(html: string): {
	likely: boolean;
	indicators: string[];
} {
	const indicators: string[] = [];

	// Check for SPA frameworks
	if (html.includes('id="root"') || html.includes('id="app"') || html.includes('ng-app')) {
		indicators.push('Common SPA root element');
	}

	// Check for minimal body content (SPAs often have empty-looking HTML)
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	if (bodyMatch) {
		const bodyContent = bodyMatch[1]
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '');
		const textLength = bodyContent.replace(/<[^>]+>/g, '').trim().length;
		if (textLength < 500) {
			indicators.push('Minimal body content (< 500 chars)');
		}
	}

	// Check for SPA framework indicators
	const spaPatterns = [
		{ pattern: /data-react-root|data-vue-app/, name: 'React/Vue app' },
		{ pattern: /__NEXT_DATA__/, name: 'Next.js' },
		{ pattern: /nuxt-app/, name: 'Nuxt.js' },
		{ pattern: /angular.*module/, name: 'Angular app' },
		{ pattern: /v-app.*class=/, name: 'Vuetify app' },
	];

	for (const { pattern, name } of spaPatterns) {
		if (pattern.test(html)) {
			indicators.push(name);
		}
	}

	return {
		likely: indicators.length > 0,
		indicators,
	};
}

/**
 * Convert HTML to Markdown using turndown with cleaning
 */
export function convertToMarkdown(html: string): string {
	// First clean the HTML
	const cleanedHtml = cleanHtml(html);

	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
	});

	// Preserve code blocks in pre tags
	td.addRule('preserveCodeBlocks', {
		filter: (node) => node.nodeName === 'PRE' && !!node.querySelector('code'),
		replacement: (content) => content,
	});

	let markdown = td.turndown(cleanedHtml);

	// Post-process markdown to remove any remaining unwanted content
	markdown = postProcessMarkdown(markdown);

	return markdown;
}

/**
 * Post-process markdown to remove unwanted content
 */
function postProcessMarkdown(markdown: string): string {
	let cleaned = markdown;

	// Remove empty lines at start
	cleaned = cleaned.replace(/^\s*\n+/, '');

	// Remove CSS-like content (lines starting with : or . that look like CSS)
	cleaned = cleaned
		.split('\n')
		.filter((line) => {
			// Skip lines that are clearly CSS
			if (line.match(/^\s*:[a-z-]+\s*\{/)) return false; // CSS rules like :root {
			if (line.match(/^\s*\.[a-z-]+\s*\{/)) return false; // CSS class rules
			if (line.match(/^\s*\[[a-z-]+\]/)) return false; // CSS attribute selectors
			if (line.match(/^\s*\{[\s\S]*\}$/)) return false; // CSS blocks
			if (line.match(/^\s*\*\s/)) return false; // CSS list items
			if (line.match(/^\s*--[a-z-]+:/)) return false; // CSS custom properties
			if (line.match(/^\s*background:/i)) return false;
			if (line.match(/^\s*color:/i)) return false;
			if (line.match(/^\s*display:/i)) return false;
			return true;
		})
		.join('\n');

	// Remove JSON-like content (lines starting with { or containing "key":)
	cleaned = cleaned
		.split('\n')
		.filter((line) => {
			const trimmed = line.trim();
			// Skip JSON objects
			if (trimmed.startsWith('{"') || trimmed.startsWith('{"props"')) return false;
			if (trimmed.startsWith('{"payload"')) return false;
			if (trimmed.startsWith('{"locale"')) return false;
			// Skip lines that are mostly JSON
			if (trimmed.match(/^"[^"]+":\s*[{[]/) && trimmed.length > 50) return false;
			return true;
		})
		.join('\n');

	// Remove repeated dashes/brackets
	cleaned = cleaned.replace(/^\s*\*\*\*+$/gm, '');
	cleaned = cleaned.replace(/^\s*---+\s*$/gm, '');

	// Collapse multiple blank lines
	cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

	// Remove leading/trailing whitespace from each line (optional, helps with indented content)
	// cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
	// Not doing this to preserve code block indentation

	return cleaned.trim();
}
