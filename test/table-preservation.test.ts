import { describe, it, expect } from 'vitest';
import { removeMarkdownAnchors, extractEmbeddedImages } from '../extensions/index';

describe('Table Preservation', () => {
	describe('removeMarkdownAnchors', () => {
		it('preserves simple markdown tables', () => {
			const input = `| Column A | Column B |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves tables with various alignments', () => {
			const input = `| Left | Center | Right |
|:-----|:------:|------:|
| L1   | C1     | R1    |
| L2   | C2     | R2    |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves tables with links in cells', () => {
			const input = `| Name | Link |
|------|------|
| [GitHub](https://github.com) | Visit |
| [npm](https://npmjs.com) | Package |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves tables with anchor links in cells', () => {
			const input = `| Feature | Status |
|---------|--------|
| [](#feature-a) | Done |
| [](#feature-b) | Pending |`;
			const result = removeMarkdownAnchors(input);
			// Anchor should be removed, but table structure preserved
			expect(result).toContain('|');
			expect(result).toContain('Feature');
			expect(result).toContain('Status');
			expect(result).not.toContain('[](#');
		});

		it('preserves tables with images in cells', () => {
			const input = `| Icon | Name |
|------|------|
| ![](icon.png) | Item 1 |
| ![](icon2.png) | Item 2 |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves tables with special characters', () => {
			const input = `| Name | Description |
|------|-------------|
| Test | With (parentheses) |
| Foo | With [brackets] |
| Bar | With $variables |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('handles tables with code in cells', () => {
			const input = `| Language | Version |
|----------|---------|
| \`typescript\` | 5.0 |
| \`python\` | 3.11 |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('handles inline code in table cells', () => {
			const input = `| Command | Description |
|---------|-------------|
| \`npm install\` | Install deps |
| \`git commit\` | Save changes |`;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});
	});

	describe('extractEmbeddedImages', () => {
		it('preserves tables with embedded images', async () => {
			const input = `| Image | Name |
|------|------|
| ![logo](data:image/png;base64,abc) | Company |
| ![icon](https://example.com/icon.png) | App |`;
			const result = await extractEmbeddedImages(input);
			// Table structure should be preserved
			expect(result.content).toContain('|');
			expect(result.content).toContain('Image');
			expect(result.content).toContain('Name');
			// Images should be converted to references
			expect(result.content).toContain('![logo][ref-1]');
			expect(result.content).toContain('![icon][ref-2]');
			// Temp file should be created
			expect(result.tempFilePath).toBeDefined();
		});

		it('preserves tables after image extraction', async () => {
			const input = `| Col1 | Col2 |
|------|------|
| A    | B    |`;
			const result = await extractEmbeddedImages(input);
			expect(result.content).toBe(input);
		});

		it('handles tables with anchors', async () => {
			const input = `| Section | Content |
|---------|---------|
| [](#intro) | Introduction |
| [](#details) | Details |`;
			const step1 = removeMarkdownAnchors(input);
			const step2 = await extractEmbeddedImages(step1);
			// Anchors removed, table preserved
			expect(step2.content).toContain('| Section |');
			expect(step2.content).not.toContain('[](#');
		});
	});

	describe('Full pipeline', () => {
		it('preserves complex table through full pipeline', async () => {
			const input = `# Features

| Icon | Feature | Status |
|------|---------|--------|
| ![](data:image/png;base64,abc) | [](#feat1) Login | Done |
| ![](data:image/png;def) | [](#feat2) Logout | Pending |

| Config | Value |
|--------|-------|
| \`timeout\` | 30 |
| \`retries\` | 3 |`;

			const step1 = removeMarkdownAnchors(input);
			const step2 = await extractEmbeddedImages(step1);

			// All tables should be preserved
			expect(step2.content).toContain('| Icon | Feature | Status |');
			expect(step2.content).toContain('| Config | Value |');
			expect(step2.content).toContain('|------|---------|--------|');
			expect(step2.content).toContain('| \`timeout\` | 30 |');

			// Images converted to references (check for ref style images)
			expect(step2.content).toMatch(/!\[.*?\]\[ref-\d+\]/);

			// No anchors
			expect(step2.content).not.toContain('[](#');
		});
	});
});
