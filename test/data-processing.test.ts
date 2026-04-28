import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	removeMarkdownAnchors,
	stripEmbeddedImages,
	extractEmbeddedImages,
} from '../extensions/index';

const TEST_DATA_DIR = join(__dirname, 'data');

describe('Test Data Processing', () => {
	const testFiles = readdirSync(TEST_DATA_DIR).filter((f) => f.endsWith('.md'));

	it('has test data files', () => {
		expect(testFiles.length).toBeGreaterThan(0);
	});

	testFiles.forEach((file) => {
		describe(`Processing: ${file}`, () => {
			const content = readFileSync(join(TEST_DATA_DIR, file), 'utf-8');

			it('removeMarkdownAnchors should not leave [](#anchor) patterns outside code blocks', () => {
				const result = removeMarkdownAnchors(content);
				// Check anchors outside code blocks only
				const withoutCodeBlocks = result.replace(/```[\s\S]*?```/g, '');
				const anchorMatches = withoutCodeBlocks.match(/\[\]\(#[^)]+\)/g);
				expect(anchorMatches).toBeNull();
				// Code blocks should be preserved
				const codeBlockCount = (result.match(/```[\s\S]*?```/g) || []).length;
				const originalCodeBlockCount = (content.match(/```[\s\S]*?```/g) || []).length;
				expect(codeBlockCount).toBe(originalCodeBlockCount);
			});

			it('stripEmbeddedImages should remove inline image syntax outside code blocks', () => {
				const result = stripEmbeddedImages(content);
				// Check outside code blocks only
				const withoutCodeBlocks = result.replace(/```[\s\S]*?```/g, '');
				const inlineImagePattern = /!\[[^\]]*\]\((data:|https?:\/\/)[^)]+\)/g;
				const inlineImages = withoutCodeBlocks.match(inlineImagePattern);
				expect(inlineImages).toBeNull();
			});

			it('extractEmbeddedImages should create temp file with references', async () => {
				const result = await extractEmbeddedImages(content);

				// Count images outside code blocks (simple pattern)
				const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
				const originalImageCount =
					(withoutCodeBlocks.match(/!\[.*?\]\(https?:\/\/[^)]+\)/g) || []).length +
					(withoutCodeBlocks.match(/!\[.*?\]\(data:/g) || []).length;

				if (originalImageCount > 0) {
					expect(result.tempFilePath).toBeDefined();
					expect(result.tempFilePath).toContain('webfetch-images');

					// Content should have reference-style images (outside code blocks)
					const contentWithoutCodeBlocks = result.content.replace(/```[\s\S]*?```/g, '');
					const refStyleImages =
						contentWithoutCodeBlocks.match(/!\[[^\]]*\]\[ref-\d+\]/g) || [];
					// At least some images should be extracted
					expect(refStyleImages.length).toBeGreaterThan(0);
				}
			});

			it('should preserve code blocks', () => {
				const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
				const result = removeMarkdownAnchors(content);

				// Count code blocks after processing
				const resultCodeBlocks = result.match(/```[\s\S]*?```/g) || [];
				expect(resultCodeBlocks.length).toBe(codeBlocks.length);
			});

			it('should preserve tables', () => {
				const tables =
					content.match(/\|.+\|[\r\n]+\|[-:\s|]+\|[\r\n]+(?:\|.+\|[\r\n]*)+/g) || [];
				const result = removeMarkdownAnchors(content);

				// If there were tables, they should be preserved
				if (tables.length > 0) {
					expect(result).toContain('|');
				}
			});

			it('should handle real links (not anchors)', () => {
				const realLinks = content.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g) || [];
				const result = removeMarkdownAnchors(content);

				// Real links should still be present
				realLinks.forEach((link) => {
					expect(result).toContain(link);
				});
			});
		});
	});
});

describe('Individual Test File Validation', () => {
	it('01-all-elements: processes all element types correctly', async () => {
		const content = readFileSync(join(TEST_DATA_DIR, '01-all-elements.md'), 'utf-8');

		// Should have anchors to remove (outside code blocks)
		const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
		const anchors = withoutCodeBlocks.match(/\[\]\(#[^)]+\)/g);
		expect(anchors && anchors.length).toBeGreaterThan(0);

		// Should have images to extract (outside code blocks)
		const images = withoutCodeBlocks.match(/!\[.*?\]\(https?:\/\/[^)]+\)/g);
		expect(images && images.length).toBeGreaterThan(0);

		// Process
		const noAnchors = removeMarkdownAnchors(content);
		const withoutAnchorsOutsideCodeBlocks = noAnchors.replace(/```[\s\S]*?```/g, '');
		expect(withoutAnchorsOutsideCodeBlocks.match(/\[\]\(#[^)]+\)/g)).toBeNull();
	});

	it('02-only-anchors: removes only anchor patterns', () => {
		const content = readFileSync(join(TEST_DATA_DIR, '02-only-anchors.md'), 'utf-8');

		// Only anchors, no images (outside code blocks)
		const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
		const anchors = withoutCodeBlocks.match(/\[\]\(#[^)]+\)/g);
		const images = withoutCodeBlocks.match(/!\[.*?\]\(https?:\/\/[^)]+\)/g);

		expect(anchors && anchors.length).toBeGreaterThan(0);
		expect(images).toBeNull();

		const result = removeMarkdownAnchors(content);
		const resultWithoutCodeBlocks = result.replace(/```[\s\S]*?```/g, '');
		expect(resultWithoutCodeBlocks.match(/\[\]\(#[^)]+\)/g)).toBeNull();
	});

	it('03-only-images: extracts all image types', async () => {
		const content = readFileSync(join(TEST_DATA_DIR, '03-only-images.md'), 'utf-8');

		// Should have data URI and external images (outside code blocks)
		const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');
		const externalImages = withoutCodeBlocks.match(/https?:\/\/[^)]+\.(png|jpg|svg)/g);

		expect(externalImages && externalImages.length).toBeGreaterThan(0);

		const result = await extractEmbeddedImages(content);
		expect(result.tempFilePath).toBeDefined();

		// Original images should be replaced with references
		const contentWithoutCodeBlocks = result.content.replace(/```[\s\S]*?```/g, '');
		const refImages = contentWithoutCodeBlocks.match(/!\[[^\]]*\]\[ref-\d+\]/g);
		expect(refImages && refImages.length).toBeGreaterThan(0);
	});

	it('04-only-codeblocks: preserves all code blocks', () => {
		const content = readFileSync(join(TEST_DATA_DIR, '04-only-codeblocks.md'), 'utf-8');

		const codeBlocks = {
			typescript: (content.match(/```typescript[\s\S]*?```/g) || []).length,
			python: (content.match(/```python[\s\S]*?```/g) || []).length,
			bash: (content.match(/```bash[\s\S]*?```/g) || []).length,
			go: (content.match(/```go[\s\S]*?```/g) || []).length,
			json: (content.match(/```json[\s\S]*?```/g) || []).length,
			sql: (content.match(/```sql[\s\S]*?```/g) || []).length,
		};

		expect(codeBlocks.typescript).toBe(1);
		expect(codeBlocks.python).toBe(1);
		expect(codeBlocks.bash).toBe(1);
		expect(codeBlocks.go).toBe(1);
		expect(codeBlocks.json).toBe(1);
		expect(codeBlocks.sql).toBe(1);

		// After processing, all code blocks should be preserved
		const result = removeMarkdownAnchors(content);

		const resultCodeBlocks = {
			typescript: (result.match(/```typescript[\s\S]*?```/g) || []).length,
			python: (result.match(/```python[\s\S]*?```/g) || []).length,
			bash: (result.match(/```bash[\s\S]*?```/g) || []).length,
		};

		expect(resultCodeBlocks.typescript).toBe(1);
		expect(resultCodeBlocks.python).toBe(1);
		expect(resultCodeBlocks.bash).toBe(1);
	});

	it('05-edge-cases: handles special characters correctly', async () => {
		const content = readFileSync(join(TEST_DATA_DIR, '05-edge-cases.md'), 'utf-8');

		// Process
		const noAnchors = removeMarkdownAnchors(content);
		const imageResult = await extractEmbeddedImages(noAnchors);

		// Should have reference images in content (outside code blocks)
		const contentWithoutCodeBlocks = imageResult.content.replace(/```[\s\S]*?```/g, '');
		const refImages = contentWithoutCodeBlocks.match(/!\[[^\]]*\]\[ref-\d+\]/g);
		expect(refImages && refImages.length).toBeGreaterThan(0);

		// Should have temp file
		expect(imageResult.tempFilePath).toBeDefined();
	});
});
