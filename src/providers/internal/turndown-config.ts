/**
 * Turndown Configuration
 *
 * Creates configured TurndownService instances for HTML to Markdown conversion.
 */

import { load } from "cheerio";
import TurndownService from "turndown";

/**
 * Create a configured TurndownService instance
 */
export function createTurndownService(): TurndownService {
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});

	// Custom rule for preserving code blocks
	td.addRule("preserveCodeBlocks", {
		filter: (node) => node.nodeName === "PRE" && !!node.querySelector("code"),
		replacement: (content) => content,
	});

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
 * Clean HTML by removing unwanted elements
 */
export function cleanHtml(html: string): string {
	const $ = load(html);
	$("script, style, nav, footer, header, aside, .header, .footer, .sidebar, .navbar").remove();
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
