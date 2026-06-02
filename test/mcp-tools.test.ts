import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createWebfetchMcpServer, type WebfetchMcpDependencies } from '../extensions/mcp-tools.js';

type TestTool = {
	inputSchema: { shape?: Record<string, unknown> };
	handler: (
		args: unknown,
		extra: never,
	) => Promise<{
		content: Array<{ type: string; text: string }>;
		structuredContent?: Record<string, unknown>;
		_meta?: Record<string, unknown>;
		isError?: boolean;
	}>;
};

function getRegisteredTools(server: McpServer): Record<string, TestTool> {
	return (server as unknown as { _registeredTools: Record<string, TestTool> })._registeredTools;
}

function getSchemaShape(tool: TestTool): Record<string, unknown> {
	return tool.inputSchema.shape ?? {};
}

function createDeps(): WebfetchMcpDependencies {
	return {
		webfetchResearch: vi.fn(async (url: string) => ({
			content: [{ type: 'text' as const, text: `fetched ${url}` }],
			details: {
				url,
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
			},
		})),
		clearCache: vi.fn(async () => true),
		clearAllCache: vi.fn(async () => 3),
	};
}

describe('createWebfetchMcpServer', () => {
	it('registers all webfetch MCP tools with input schemas', () => {
		const server = createWebfetchMcpServer(createDeps());
		const tools = getRegisteredTools(server);

		expect(Object.keys(tools).sort()).toEqual([
			'webfetch',
			'webfetch-clear-cache',
		]);
		expect(getSchemaShape(tools.webfetch)).toHaveProperty('url');
		expect(getSchemaShape(tools.webfetch)).toHaveProperty('query');
		expect(getSchemaShape(tools.webfetch)).toHaveProperty('provider');
		expect(getSchemaShape(tools['webfetch-clear-cache'])).toHaveProperty('url');
	});

	it('delegates webfetch calls to the existing research service', async () => {
		const deps = createDeps();
		const server = createWebfetchMcpServer(deps);
		const result = await getRegisteredTools(server).webfetch.handler(
			{
				url: 'https://example.com',
				query: 'Summarize',
				provider: 'gh-cli',
			},
			{} as never,
		);

		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://example.com',
			'Summarize',
			undefined,
			undefined,
			undefined,
			'gh-cli',
		);
		expect(result.content[0]).toEqual({ type: 'text', text: 'fetched https://example.com' });
		expect(result.structuredContent).toEqual({
			url: 'https://example.com',
			contentType: 'text/html',
			status: 200,
			processedAs: 'spa',
		});
		expect(result._meta).toEqual({
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa',
			},
		});
		expect(result.isError).toBe(false);
	});

	it('delegates cache clear tools', async () => {
		const deps = createDeps();
		const server = createWebfetchMcpServer(deps);
		const tools = getRegisteredTools(server);

		const clearOne = await tools['webfetch-clear-cache'].handler(
			{ url: 'https://example.com' },
			{} as never,
		);
		const clearAll = await tools['webfetch-clear-cache'].handler({}, {} as never);

		expect(deps.clearCache).toHaveBeenCalledWith('https://example.com');
		expect(clearOne.structuredContent).toEqual({ url: 'https://example.com', cleared: true });
		expect(deps.clearAllCache).toHaveBeenCalled();
		expect(clearAll.structuredContent).toEqual({ clearedCount: 3 });
	});
});
