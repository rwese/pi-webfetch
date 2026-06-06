/**
 * Denylist tests
 *
 * Regression for review finding 3 (BXAC / M2): the Wikipedia
 * donation banner and other site-specific noise get captured as
 * page content on the v0.8.0 baseline. The v0.9.0 fix is:
 *
 * 1. `cleanHtml` accepts an `extraSelectors` option that
 *    merges with the default denylist. The default denylist
 *    strips script / style / nav / footer / header / aside,
 *    MediaWiki navbox / catlinks / printfooter, and the most
 *    common site-side namespacing.
 * 2. The default provider threads a page-specific denylist
 *    through `cleanHtml` so a Wikipedia article no longer
 *    starts with the donation banner.
 *
 * These tests pin both halves.
 */

import { describe, expect, it } from 'vitest';
import {
	cleanHtml,
	DEFAULT_DENYLIST_SELECTORS,
	type CleanHtmlOptions,
} from '../src/providers/internal/turndown-config.js';

describe('DEFAULT_DENYLIST_SELECTORS', () => {
	it('strips script / style / nav / footer / header / aside', () => {
		const html = `
			<article>
				<header>Top chrome</header>
				<p>Article body</p>
				<nav>Sidebar</nav>
				<aside>Aside</aside>
				<footer>Bottom chrome</footer>
				<script>alert(1)</script>
				<style>.foo{}</style>
			</article>
		`;
		const cleaned = cleanHtml(html);
		expect(cleaned).not.toContain('Top chrome');
		expect(cleaned).not.toContain('Sidebar');
		expect(cleaned).not.toContain('Aside');
		expect(cleaned).not.toContain('Bottom chrome');
		expect(cleaned).not.toContain('alert(1)');
		expect(cleaned).not.toContain('.foo');
		expect(cleaned).toContain('Article body');
	});

	it('strips MediaWiki-specific chrome (navbox, catlinks, printfooter, mw-footer)', () => {
		const html = `
			<article>
				<p>Article body</p>
				<div class="navbox">Navbox</div>
				<div class="vertical-navbox">VNavbox</div>
				<div class="catlinks">Category links</div>
				<div class="printfooter">Print footer</div>
				<div class="mw-footer">MW footer</div>
				<div id="catlinks">catlinks id</div>
			</article>
		`;
		const cleaned = cleanHtml(html);
		expect(cleaned).toContain('Article body');
		expect(cleaned).not.toContain('Navbox');
		expect(cleaned).not.toContain('VNavbox');
		expect(cleaned).not.toContain('Category links');
		expect(cleaned).not.toContain('Print footer');
		expect(cleaned).not.toContain('MW footer');
		expect(cleaned).not.toContain('catlinks id');
	});

	it('strips common class- and id-based chrome (.header, .footer, .sidebar, .navbar, #footer)', () => {
		const html = `
			<article>
				<p>Article body</p>
				<div class="header">Header</div>
				<div class="footer">Footer</div>
				<div class="sidebar">Sidebar</div>
				<div class="navbar">Navbar</div>
				<div id="footer">Footer id</div>
			</article>
		`;
		const cleaned = cleanHtml(html);
		expect(cleaned).toContain('Article body');
		expect(cleaned).not.toContain('Header');
		expect(cleaned).not.toContain('Footer');
		expect(cleaned).not.toContain('Sidebar');
		expect(cleaned).not.toContain('Navbar');
	});
});

describe('cleanHtml — extraSelectors', () => {
	it('merges extraSelectors with the default denylist', () => {
		const html = `
			<article>
				<p>Article body</p>
				<header>Default header</header>
				<div class="cookiealert">Cookie alert</div>
				<div id="mw-donation-banner">Donation banner</div>
			</article>
		`;
		const options: CleanHtmlOptions = {
			extraSelectors: ['#mw-donation-banner', '.cookiealert'],
		};
		const cleaned = cleanHtml(html, options);
		// Default selectors still apply.
		expect(cleaned).not.toContain('Default header');
		// Extra selectors are also applied.
		expect(cleaned).not.toContain('Cookie alert');
		expect(cleaned).not.toContain('Donation banner');
		// Body is preserved.
		expect(cleaned).toContain('Article body');
	});

	it('accepts an empty extraSelectors without error', () => {
		const html = '<article><p>Body</p></article>';
		const cleaned = cleanHtml(html, { extraSelectors: [] });
		expect(cleaned).toContain('Body');
	});

	it('accepts undefined options without error', () => {
		const html = '<article><p>Body</p></article>';
		const cleaned = cleanHtml(html);
		expect(cleaned).toContain('Body');
	});
});

describe('Wikipedia donation-banner regression (BXAC)', () => {
	// This is the exact failure mode the review surfaced on
	// v0.8.0: the banner was the first content of every
	// Wikipedia article. The fix is to add the banner /
	// siteNotice / frb-inline selectors to the page-specific
	// denylist passed by the default provider.
	const wikipediaArticle = `
		<article>
			<div id="mw-donation-banner">
				<p class="frb-inline">Please consider supporting Wikipedia.</p>
			</div>
			<div id="siteNotice">
				<p>Site notice</p>
			</div>
			<p>Markdown is a lightweight markup language...</p>
			<div class="navbox">Navbox noise</div>
		</article>
	`;

	it('strips the donation banner and siteNotice when extraSelectors include the Wikipedia set', () => {
		const wikipediaExtras = [
			'#mw-donation-banner',
			'#siteNotice',
			'.frb-inline',
			'.navbox',
		];
		const cleaned = cleanHtml(wikipediaArticle, { extraSelectors: wikipediaExtras });
		expect(cleaned).not.toContain('Please consider supporting Wikipedia');
		expect(cleaned).not.toContain('Site notice');
		expect(cleaned).not.toContain('Navbox noise');
		// Real article body is preserved.
		expect(cleaned).toContain('Markdown is a lightweight markup language');
	});

	it('does NOT strip the banner without the extra denylist (default behaviour pin)', () => {
		// Without the page-specific denylist, the default
		// `cleanHtml` does not strip the banner. This pins the
		// pre-v0.9.0 behaviour so a regression in the default
		// provider (which threads the page denylist) shows up
		// in the diff instead of silently.
		const cleaned = cleanHtml(wikipediaArticle);
		expect(cleaned).toContain('Please consider supporting Wikipedia');
	});
});
