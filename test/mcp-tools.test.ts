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
	};
}

describe('createWebfetchMcpServer', () => {
	it('registers webfetch tool with input schema', () => {
		const server = createWebfetchMcpServer(createDeps());
		const tools = getRegisteredTools(server);

		expect(Object.keys(tools).sort()).toEqual(['webfetch']);
		expect(getSchemaShape(tools.webfetch)).toHaveProperty('url');
		expect(getSchemaShape(tools.webfetch)).toHaveProperty('query');
	});

	it('delegates webfetch calls to the existing research service', async () => {
		const deps = createDeps();
		const server = createWebfetchMcpServer(deps);
		const result = await getRegisteredTools(server).webfetch.handler(
			{
				url: 'https://example.com',
				query: 'Summarize',
			},
			{} as never,
		);

		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://example.com',
			'Summarize',
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
});