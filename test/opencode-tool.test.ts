import { describe, expect, it, vi } from 'vitest';
import {
	createOpenCodeWebfetchTool,
	type OpenCodeWebfetchContext,
	type OpenCodeWebfetchDependencies,
} from '../extensions/opencode-tool.js';

const context: OpenCodeWebfetchContext = {
	agent: 'build',
	sessionID: 'session-1',
	messageID: 'message-1',
	directory: '/tmp/project',
	worktree: '/tmp/project',
};

function createDeps(): OpenCodeWebfetchDependencies {
	return {
		webfetchResearch: vi.fn(async (url: string) => ({
			content: [{ type: 'text' as const, text: `fetched ${url}` }],
			details: {
				url,
				contentType: 'text/html',
				status: 200,
				processedAs: 'html' as const,
			},
		})),
	};
}

describe('OpenCode webfetch tool', () => {
	it('exposes the OpenCode custom-tool contract', () => {
		const tool = createOpenCodeWebfetchTool(createDeps());

		expect(tool.description).toContain('Fetch and process web pages');
		expect(tool.args).toHaveProperty('url');
		expect(tool.args).toHaveProperty('query');
		expect(tool.args).toHaveProperty('includeComments');
		expect(tool.args).toHaveProperty('timeout');
		expect(tool.args).toHaveProperty('cacheTtlMs');
	});

	it('returns text and forwards OpenCode arguments to the research service', async () => {
		const deps = createDeps();
		const tool = createOpenCodeWebfetchTool(deps);
		const result = await tool.execute(
			{
				url: 'https://example.com',
				query: 'Summarize',
				includeComments: false,
				timeout: 120000,
				cacheTtlMs: 60000,
			},
			context,
		);

		expect(result).toBe('fetched https://example.com');
		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://example.com',
			'Summarize',
			undefined,
			undefined,
			undefined,
			undefined,
			{ github: { includeComments: false }, cacheTtlMs: 60000 },
			expect.any(Function),
			undefined,
			'mcp',
			120000,
		);
	});
});
