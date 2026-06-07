/**
 * Turndown Configuration
 *
 * Creates configured TurndownService instances for HTML to Markdown conversion.
 */

import { load } from "cheerio";
import TurndownService from "turndown";

/**
 * Add the wikitable rule to a `TurndownService` so MediaWiki
 * `<table class="wikitable">` tables survive the HTML → markdown
 * conversion as proper GFM tables instead of being mangled by
 * the default column-header heuristic. Called from
 * `createTurndownService()`; exported as a separate helper so
 * tests can compose their own `TurndownService` and apply
 * the wikitable rule independently.
 */
function addWikitableRule(td: TurndownService): void {
	td.addRule('wikitable', {
		filter: (node) => {
			if (node.nodeName !== 'TABLE') return false;
			const className = (node as unknown as { className?: string }).className ?? '';
			return typeof className === 'string' && /\bwikitable\b/i.test(className);
		},
		replacement: (_content, node) => {
			// Build a GFM-style table by walking the DOM.
			// We trust the first `<thead> / <tr>` row as the
			// header; if there is no `<thead>`, the first `<tr>`
			// is treated as the header (turndown's default
			// heuristic over-claimed `<th>`-less first rows as
			// headers and broke wikitable's actual headers).
			const tableNode = node as unknown as {
				querySelectorAll: (selectors: string) => NodeListOf<Element>;
			};
			const rows: Array<{ cells: string[]; isHeader: boolean }> = [];
			const trs = tableNode.querySelectorAll('tr');
			trs.forEach((tr) => {
				const cellNodes = tr.querySelectorAll('th, td');
				const cells: string[] = [];
				cellNodes.forEach((c) => {
					// Strip nested tables and turndown's anchor
					// noise from the cell text. The cell text
					// itself is taken from `textContent` to avoid
					// nested-html re-conversion; we then pipe
					// each cell through the turndown service to
					// get its own markdown for inline content
					// (links, emphasis, code).
					cells.push(td['turndown'](c.innerHTML ?? '').trim());
				});
				const isHeader = !!tr.querySelector('th');
				rows.push({ cells, isHeader });
			});
			if (rows.length === 0) return '';
			// Pick the first row that is either an explicit
			// `<thead>` descendant or the first `<tr>` of the
			// table. Both are common on MediaWiki.
			let headerIdx = rows.findIndex((r) => r.isHeader);
			if (headerIdx === -1) headerIdx = 0;
			const header = rows[headerIdx];
			if (!header) return '';
			const columnCount = header.cells.length;
			// Normalise: pad / truncate every body row to the
			// header column count.
			const normalised = rows.map((r) => {
				const padded = r.cells.slice(0, columnCount);
				while (padded.length < columnCount) padded.push('');
				return padded.map((c) => c.replace(/\|/g, '\\|').replace(/\n+/g, ' '));
			});
			const headerCells = normalised[headerIdx] ?? header.cells;
			const sep = headerCells.map(() => '---');
			const body = normalised
				.filter((_, i) => i !== headerIdx)
				.map((cells) => `| ${cells.join(' | ')} |`);
			return [
				`| ${headerCells.join(' | ')} |`,
				`| ${sep.join(' | ')} |`,
				...body,
			].join('\n');
		},
	});
}

/**
 * Add the MediaWiki MathJax rule to a `TurndownService` so
 * the inline `mwe-math-*` wrapper produces only the rendered
 * `<img>` in markdown output. The default `textContent`
 * extraction would otherwise emit the literal TeX source
 * 3-4 times per formula (the MathML `<annotation
 * encoding="TeX">`, the `<img alt="...">`, and a
 * `<span style="display: none">` fallback), which
 * BUG-2026-06-06-JGCMZSOB-YZOYE flagged as a fidelity
 * regression. The rule keeps the rendered image (with its
 * alt text) and drops the rest of the wrapper.
 */
function addMathJaxRule(td: TurndownService): void {
	td.addRule('mwe-math', {
		filter: (node) => {
			const className = (node as unknown as { className?: string }).className ?? '';
			return (
				typeof className === 'string' &&
				/\bmwe-math-(mathml|math)-?(display|inline)\b/i.test(className)
			);
		},
		replacement: (_content, node) => {
			// Pick the first <img> descendant and render it
			// as a markdown image link. The alt text is
			// the same TeX source the user would have seen
			// visually, so it stays in the output (without
			// the alt text, the rendered image is a blank
			// link, and the LLM downstream has no
			// representation of the formula).
			const containerNode = node as unknown as {
				querySelector: (selector: string) => Element | null;
			};
			const img = containerNode.querySelector('img');
			if (!img) return '';
			const imgNode = img as unknown as {
				getAttribute: (name: string) => string | null;
			};
			const src = imgNode.getAttribute('src');
			if (!src) return '';
			const alt = imgNode.getAttribute('alt') ?? '';
			return `![${alt}](${src})`;
		},
	});
}

/**
 * Create a configured TurndownService instance
 */
export function createTurndownService(): TurndownService {
	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-',
	});

	// Custom rule for preserving code blocks
	td.addRule('preserveCodeBlocks', {
		filter: (node) => node.nodeName === 'PRE' && !!node.querySelector('code'),
		replacement: (content) => content,
	});

	// Wikitable tables: convert `<table class="wikitable">` to
	// GFM tables instead of letting turndown's default
	// `<th>`-first-row heuristic mangle the headers. See
	// review finding 4 (BXAD / M2).
	addWikitableRule(td);

	// MediaWiki inline MathJax: BUG-2026-06-06-JGCMZSOB-YZOYE.
	// The default `textContent` extraction leaks the TeX
	// source 3-4 times per formula; this rule keeps only
	// the rendered `<img>`.
	addMathJaxRule(td);

	return td;
}

/**
 * Extract title from HTML
 */
export function extractTitle(html: string): string | undefined {
	const $ = load(html);
	const title = $("title").text().trim();
	return title || undefined;
}

/**
 * Default selectors stripped from rendered HTML before
 * markdown conversion. Covers the worst offenders on real-world
 * pages: chrome (header / footer / nav / aside), MediaWiki
 * (navbox, category links, print footer), and the most common
 * site-side namespacing. Tests can extend the list via
 * `cleanHtml(html, { extraSelectors })` for page-specific
 * pollution (e.g. Wikipedia's donation banner, cookie walls,
 * interstitials).
 */
export const DEFAULT_DENYLIST_SELECTORS: ReadonlyArray<string> = [
	'script',
	'style',
	'nav',
	'footer',
	'header',
	'aside',
	'.header',
	'.footer',
	'.sidebar',
	'.navbar',
	// MediaWiki/Wikipedia navigation and category chrome.
	'.navbox',
	'.vertical-navbox',
	'.metadata',
	'.catlinks',
	'.printfooter',
	'.mw-footer',
	'#catlinks',
	'#footer',
];

/**
 * Options for {@link cleanHtml}.
 *
 * - `extraSelectors`: page-specific selectors to remove in
 *   addition to the defaults. Used by the default provider to
 *   handle the Wikipedia donation banner, sidebar noise, etc.
 *   The list is merged with the defaults; existing default
 *   selectors are always applied.
 */
export interface CleanHtmlOptions {
	extraSelectors?: ReadonlyArray<string>;
}

/**
 * Clean HTML by removing unwanted elements. The default
 * `DEFAULT_DENYLIST_SELECTORS` strip the most common chrome
 * (header / footer / nav / aside), MediaWiki navboxes /
 * category links, and a handful of class- and id-based
 * sidebar / navbar patterns.
 *
 * Tests and downstream callers can pass `extraSelectors` to
 * extend the list. `null` / `undefined` extra selectors are
 * ignored; duplicates are not de-duplicated (cheerio's
 * `$()` is happy to re-process the same selector).
 */
export function cleanHtml(html: string, options?: CleanHtmlOptions): string {
	const $ = load(html);
	const extras = options?.extraSelectors ?? [];
	const merged = [...DEFAULT_DENYLIST_SELECTORS, ...extras];
	$(merged.join(', ')).remove();
	return $.html();
}

/**
 * Calculate text ratio in HTML
 */
export function calculateTextRatio(html: string): number {
	const $ = load(html);
	const textContent = $.text();
	return textContent.length / Math.max(html.length, 1);
}
