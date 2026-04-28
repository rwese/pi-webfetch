import { describe, it, expect } from 'vitest';
import {
	removeMarkdownAnchors,
	extractEmbeddedImages,
	stripEmbeddedImages,
} from '../extensions/index';

describe('Code Block Preservation', () => {
	describe('removeMarkdownAnchors', () => {
		it('preserves TypeScript code blocks with markdown-like content', () => {
			const input = `\`\`\`typescript
// [link](url) and ![img](url)
const x = "[](#anchor)";
function test(a: string[], b: { key: value }): void {}
\`\`\``;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves Python code blocks with parentheses', () => {
			const input = `\`\`\`python
result = func(arg1, arg2)
text = "[](#test)"
\`\`\``;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves Bash code blocks', () => {
			const input = '```bash\necho $HOME\narray[0]=$(date)\n```';
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('preserves JSON code blocks with brackets', () => {
			const input = `\`\`\`json
{"arr": [1, 2, 3], "nested": {"x": "[](#y)"}}
\`\`\``;
			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});

		it('handles multiple code blocks in document', () => {
			const input = `Some text before.

\`\`\`typescript
const x = "[](#anchor)";
\`\`\`

Middle text.

\`\`\`python
x = "[](#anchor)"
\`\`\`

After text.`;

			const result = removeMarkdownAnchors(input);
			expect(result).toBe(input);
		});
	});

	describe('extractEmbeddedImages', () => {
		it('does not modify code blocks', async () => {
			const input = `Regular text.

\`\`\`typescript
const img = "![real](image.png)";
const link = "[](#anchor)";
\`\`\`

After code.`;

			const result = await extractEmbeddedImages(input);
			// Code block should be unchanged
			expect(result.content).toContain('```typescript');
			expect(result.content).toContain('const img = "![real](image.png)";');
			expect(result.content).toContain('const link = "[](#anchor)";');
		});

		it('extracts images outside code blocks only', async () => {
			const input = `Regular text ![img](https://example.com/img.png).

\`\`\`typescript
const x = "![inline](should-not-extract.png)";
\`\`\``;

			const result = await extractEmbeddedImages(input);
			// Image outside code block should be extracted
			expect(result.content).toContain('![img][ref-1]');
			// Image inside code block should be preserved
			expect(result.content).toContain('![inline](should-not-extract.png)');
			expect(result.tempFilePath).toBeDefined();
		});
	});

	describe('stripEmbeddedImages', () => {
		it('does not modify code blocks', () => {
			const input = `\`\`\`typescript
const img = "![alt](url.png)";
const link = "[](#anchor)";
\`\`\``;
			const result = stripEmbeddedImages(input);
			expect(result).toBe(input);
		});
	});

	describe('Full pipeline preservation', () => {
		it('preserves all code blocks through full pipeline', async () => {
			const input = `# Document

\`\`\`typescript
interface Config {
    urls: string[];
    callback: (data: { key: value }) => void;
}
\`\`\`

\`\`\`python
def process(items):
    for item in items:
        yield item
\`\`\`

End.`;

			const step1 = removeMarkdownAnchors(input);
			const step2 = await extractEmbeddedImages(step1);

			// All code blocks preserved
			expect(step2.content).toContain('```typescript');
			expect(step2.content).toContain('```python');

			// Content inside code blocks unchanged
			expect(step2.content).toContain('urls: string[]');
			expect(step2.content).toContain('def process');
		});
	});
});
