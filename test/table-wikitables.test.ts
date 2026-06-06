/**
 * Wikitable turndown rule tests
 *
 * Regression for review finding 4 (BXAD / M2): turndown's
 * default column-header heuristic mangles
 * `<table class="wikitable">` tables (e.g. the Wikipedia
 * "Markdown" article's table of language features). The
 * heuristic looks for a `<th>`-only first row; wikitable rows
 * can have a mix of `<th>` and `<td>` in the header, plus
 * rowspans / colspans, so the heuristic picks the wrong row
 * and emits a header line of "<th>, <td>, <td>" against a
 * body of "Feature, Example, Notes".
 *
 * The v0.9.0 fix: a custom `wikitable` rule on
 * `TurndownService` that emits a GFM table directly from the
 * DOM, normalises the column count, and escapes pipe
 * characters in cell text.
 */

import { describe, expect, it } from 'vitest';
import { createTurndownService } from '../src/providers/internal/turndown-config.js';

describe('createTurndownService — wikitable rule', () => {
	const td = createTurndownService();

	it('emits a GFM table from a `<table class="wikitable">`', () => {
		const html = `
			<table class="wikitable">
				<thead>
					<tr>
						<th>Feature</th>
						<th>Example</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					<tr><td>Heading</td><td>H1</td><td>Atx style</td></tr>
					<tr><td>List</td><td>a, b</td><td>Unordered</td></tr>
				</tbody>
			</table>
		`;
		const md = td.turndown(html);
		// Header is preserved.
		expect(md).toMatch(/^\| Feature \| Example \| Notes \|$/m);
		expect(md).toMatch(/^\| --- \| --- \| --- \|$/m);
		// Body rows are present, normalised to the column count.
		expect(md).toContain('| Heading | H1 | Atx style |');
		expect(md).toContain('| List | a, b | Unordered |');
	});

	it('falls back to the first row when the table has no `<thead>`', () => {
		const html = `
			<table class="wikitable">
				<tr><th>A</th><th>B</th></tr>
				<tr><td>1</td><td>2</td></tr>
				<tr><td>3</td><td>4</td></tr>
			</table>
		`;
		const md = td.turndown(html);
		expect(md).toMatch(/^\| A \| B \|$/m);
		expect(md).toContain('| 1 | 2 |');
		expect(md).toContain('| 3 | 4 |');
	});

	it('normalises rows to the header column count (pads / truncates)', () => {
		const html = `
			<table class="wikitable">
				<tr><th>A</th><th>B</th></tr>
				<tr><td>1</td></tr>
				<tr><td>x</td><td>y</td><td>z</td></tr>
			</table>
		`;
		const md = td.turndown(html);
		const lines = md.split('\n').filter((l) => l.startsWith('|') && !/^\| ---/.test(l));
		// 1 header + 2 body rows = 3 data lines.
		expect(lines).toHaveLength(3);
		// Padded row has an empty second cell.
		expect(lines[1]).toBe('| 1 |  |');
		// Truncated row keeps the first two cells.
		expect(lines[2]).toBe('| x | y |');
	});

	it('escapes `|` characters inside cell text', () => {
		const html = `
			<table class="wikitable">
				<tr><th>Col1</th><th>Col2</th></tr>
				<tr><td>with | pipe</td><td>plain</td></tr>
			</table>
		`;
		const md = td.turndown(html);
		expect(md).toContain('| with \\| pipe | plain |');
	});

	it('does not touch non-wikitable tables (turndown default rule still applies)', () => {
		const html = `
			<table>
				<thead>
					<tr><th>Header</th></tr>
				</thead>
				<tbody>
					<tr><td>Body</td></tr>
				</tbody>
			</table>
		`;
		const md = td.turndown(html);
		// Default turndown behaviour: the `<th>` row becomes the
		// header line, the body row follows. The wikitable rule
		// does not fire (no `wikitable` class), so this is a
		// smoke test for the `filter: (node) => /\bwikitable\b/`
		// selector.
		expect(md).toContain('Header');
		expect(md).toContain('Body');
	});
});
