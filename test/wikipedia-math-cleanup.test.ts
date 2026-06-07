/**
 * Wikipedia MathJax cleanup tests
 *
 * Regression for BUG-2026-06-06-JGCMZSOB-YZOYE: Wikipedia
 * inline MathJax `<span class="mwe-math-*">` elements were
 * converted by turndown to literal TeX source (e.g.
 * `{\displaystyle \pi ={\frac {C}{d}}}`) alongside the
 * rendered SVG / MathML fallback. The TeX source appeared
 * 3-4 times per formula in the output markdown.
 *
 * The v0.9.0 fix has two halves:
 *
 * 1. The default provider's `PAGE_DENYLIST_EXTRA` stack
 *    adds `span.mwe-math-mathml-display` and
 *    `span.mwe-math-mathml-inline` so cheerio's
 *    `cleanHtml` pass strips the wrapper.
 * 2. The `addMathJaxRule` turndown rule (in
 *    `turndown-config.ts`) replaces the wrapper with a
 *    single `![alt](src)` markdown image link — alt text
 *    is preserved (so the LLM downstream has a TeX-string
 *    representation of the formula) and the rest of the
 *    wrapper is dropped.
 *
 * These tests pin the end-to-end behaviour on a fixture
 * slice of the Wikipedia Pi article
 * (`test/fixtures/wikipedia-pi-math.html`).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	createTurndownService,
	cleanHtml,
	DEFAULT_DENYLIST_SELECTORS,
} from '../src/providers/internal/turndown-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures', 'wikipedia-pi-math.html');

const fixture = readFileSync(fixturePath, 'utf-8');

describe('Wikipedia MathJax cleanup (BUG-2026-06-06-JGCMZSOB-YZOYE)', () => {
	describe('cleanHtml — denylist strips the wrapper', () => {
		it('strips the mwe-math-mathml-inline wrapper when the selectors are passed in', () => {
			const cleaned = cleanHtml(fixture, {
				extraSelectors: [
					'span.mwe-math-mathml-display',
					'span.mwe-math-mathml-inline',
					'span.mwe-math-mathml-display span[style*="display: none"]',
					'span.mwe-math-mathml-inline span[style*="display: none"]',
				],
			});
			// The wrapper is gone. The article body is
			// preserved.
			expect(cleaned).not.toContain('mwe-math-mathml-inline');
			expect(cleaned).not.toContain('mwe-math-mathml-display');
			expect(cleaned).toContain('The exact ratio is called');
			expect(cleaned).toContain('Euclidean geometry');
		});

		it('does NOT strip the wrapper without the denylist (pin the regression)', () => {
			// Without the page-specific denylist, the
			// default `cleanHtml` does not strip the
			// wrapper. This pins the pre-v0.9.0 behaviour
			// so the fix is visible in the diff.
			const cleaned = cleanHtml(fixture);
			expect(cleaned).toContain('mwe-math-mathml-inline');
		});
	});

	describe('createTurndownService — MathJax rule', () => {
		const td = createTurndownService();

		it('emits a single markdown image link for an mwe-math span', () => {
			const html = `
				<p>
					Real content.
					<span class="mwe-math-mathml-inline">
						<math><semantics><mrow>...</mrow>
							<annotation encoding="TeX">\\pi = C / d</annotation>
						</semantics></math>
						<img alt="{\\displaystyle \\pi = C / d}"
						     src="https://wikimedia.org/api/rest_v1/media/math/render/svg/abc"
						     aria-hidden="true" />
						<span style="display: none;">{\\displaystyle \\pi = C / d}</span>
					</span>
				</p>
			`;
			const md = td.turndown(html);
			// The rendered image is preserved as a
			// markdown image link.
			expect(md).toContain('![{\\displaystyle \\pi = C / d}](https://wikimedia.org/api/rest_v1/media/math/render/svg/abc)');
			// The literal TeX source is NOT emitted as
			// separate text (the alt text is the only
			// place it should appear).
			// Count occurrences of the TeX source
			// *outside* the alt text. The image alt
			// appears once (in the markdown image link);
			// the literal TeX from the MathML annotation
			// and the display-none span should not appear
			// at all.
			const matches = md.match(/\\pi = C \/ d/g) ?? [];
			// Exactly one occurrence: the alt text in
			// the markdown image link.
			expect(matches).toHaveLength(1);
		});

		it('drops the wrapper entirely when there is no rendered <img>', () => {
			// Edge case: the page has the MathJax wrapper
			// but the rendered image has not loaded. The
			// rule produces empty content (no fallback
			// representation). Better than leaking TeX.
			const html = `
				<p>
					Real content.
					<span class="mwe-math-mathml-inline">
						<math><semantics><mrow>...</mrow>
							<annotation encoding="TeX">\\pi = C / d</annotation>
						</semantics></math>
					</span>
				</p>
			`;
			const md = td.turndown(html);
			expect(md).not.toContain('\\pi = C / d');
			expect(md).not.toContain('\\displaystyle');
			expect(md).not.toContain('mwe-math');
			expect(md).toContain('Real content.');
		});

		it('does not touch non-MathJax spans (e.g. regular inline content)', () => {
			const html = `
				<p>
					<span>Regular inline content.</span>
					<span class="not-mwe-math">More content.</span>
				</p>
			`;
			const md = td.turndown(html);
			expect(md).toContain('Regular inline content.');
			expect(md).toContain('More content.');
		});
	});

	describe('end-to-end — the default provider pipeline (cleanHtml)', () => {
		it('the Wikipedia Pi fixture: cleanHtml strips the MathJax wrapper (no TeX leaks, article body preserved)', () => {
			// The default provider's pipeline runs
			// `cleanHtml` first; the cheerio denylist
			// (extended with the MathJax selectors in
			// `PAGE_DENYLIST_EXTRA`) strips the wrapper
			// wholesale. The turndown step then runs on
			// the cleaned HTML. The TeX strings live in
			// the wrapper (MathML annotation, img alt,
			// display-none span); once the wrapper is
			// gone, the TeX is gone too.
			//
			// We pin the `cleanHtml` step here because
			// it is the deterministic half of the fix —
			// turndown's `addMathJaxRule` is a separate
			// code path tested above. The end-to-end
			// pipeline runs in production on the real
			// Wikipedia URL; the test pins the parts
			// that can be reproduced offline.
			const pageDenylist = [
				...DEFAULT_DENYLIST_SELECTORS,
				'span.mwe-math-mathml-display',
				'span.mwe-math-mathml-inline',
				'span.mwe-math-mathml-display span[style*="display: none"]',
				'span.mwe-math-mathml-inline span[style*="display: none"]',
			];
			const cleaned = cleanHtml(fixture, { extraSelectors: pageDenylist });

			// No literal TeX source in the cleaned body.
			expect(cleaned).not.toContain('{\\displaystyle');
			expect(cleaned).not.toContain('{\\textstyle');
			expect(cleaned).not.toContain('\\frac');
			// The MathJax wrappers are gone.
			expect(cleaned).not.toContain('mwe-math-mathml-inline');
			expect(cleaned).not.toContain('mwe-math-mathml-display');
			// The article body is preserved.
			expect(cleaned).toContain('The exact ratio is called');
			expect(cleaned).toContain('Euclidean geometry');
		});
	});
});
