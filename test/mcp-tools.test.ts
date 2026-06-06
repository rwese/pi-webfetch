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
		expect(getSchemaShape(tools.webfetch)).toHaveProperty('includeComments');
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
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			expect.any(Function),
			undefined,
			'mcp',
			undefined,
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

	it('forwards includeComments=true as a github option', async () => {
		const deps = createDeps();
		const server = createWebfetchMcpServer(deps);
		await getRegisteredTools(server).webfetch.handler(
			{
				url: 'https://github.com/foo/bar/issues/1',
				includeComments: true,
			},
			{} as never,
		);

		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://github.com/foo/bar/issues/1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ github: { includeComments: true } },
			expect.any(Function),
			undefined,
			'mcp',
			undefined,
		);
	});

	it('forwards includeComments=false as an explicit false option', async () => {
		const deps = createDeps();
		const server = createWebfetchMcpServer(deps);
		await getRegisteredTools(server).webfetch.handler(
			{
				url: 'https://github.com/foo/bar/issues/1',
				includeComments: false,
			},
			{} as never,
		);

		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://github.com/foo/bar/issues/1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ github: { includeComments: false } },
			expect.any(Function),
			undefined,
			'mcp',
			undefined,
		);
	});

	it('forwards an explicit timeout to webfetchResearch', async () => {
		const deps = createDeps();
		const server = createWebfetchMcpServer(deps);
		await getRegisteredTools(server).webfetch.handler(
			{
				url: 'https://example.com',
				query: 'q',
				timeout: 300000,
			},
			{} as never,
		);

		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			expect.any(Function),
			undefined,
			'mcp',
			300000,
		);
	});

	it('exposes timeout in the zod input schema', () => {
		const server = createWebfetchMcpServer(createDeps());
		const tools = getRegisteredTools(server);

		expect(getSchemaShape(tools.webfetch)).toHaveProperty('timeout');
	});

	it('surfaces the resume hint fields in _meta.details on the agent-error path', async () => {
		const deps = createDeps();
		(deps.webfetchResearch as ReturnType<typeof vi.fn>).mockResolvedValue({
			content: [
				{ type: 'text' as const, text: '## Fetch Result (Agent Error)\n\nbody' },
			],
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'error' as const,
				phase: 'error' as const,
				subagentSessionId: '0123456789abcdef',
				subagentSessionName: 'webfetch-research: example.com',
				resumeCommand: "pi-webfetch webfetch 'https://example.com' --query 'q'",
				notify: 'Research subagent failed.\nRe-run: pi-webfetch webfetch ...',
			},
		});

		const server = createWebfetchMcpServer(deps);
		const result = await getRegisteredTools(server).webfetch.handler(
			{ url: 'https://example.com', query: 'q' },
			{} as never,
		);

		expect(result.isError).toBe(true);
		const meta = result._meta?.details as Record<string, unknown> | undefined;
		expect(meta?.subagentSessionId).toBe('0123456789abcdef');
		expect(meta?.subagentSessionName).toBe('webfetch-research: example.com');
		expect(meta?.resumeCommand).toBe(
			"pi-webfetch webfetch 'https://example.com' --query 'q'",
		);
		expect(meta?.notify).toContain('Research subagent failed.');
		// structuredContent shape is preserved (zod stability)
		expect(result.structuredContent).toEqual({
			url: 'https://example.com',
			contentType: 'text/html',
			status: 200,
			processedAs: 'error',
		});
	});
});