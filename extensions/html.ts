// HTML extraction and conversion utilities

import TurndownService from 'turndown';

/** Extract main content from HTML using common selectors */
export function extractMainContent(html: string): { content: string; extracted: boolean } {
	if (!html) return { content: '', extracted: false };

	const selectors = [
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
		const bodyContent = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
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

/** Convert HTML to Markdown using turndown */
export function convertToMarkdown(html: string): string {
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

	return td.turndown(html);
}
