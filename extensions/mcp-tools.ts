/**
 * MCP tool registration for Codex plugin support.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { FetchResult } from './types.js';
import { webfetchResearch } from './fetch.js';

const webfetchInputSchema = {
	url: z.string().url().describe('The URL to fetch'),
	query: z.string().optional().describe('Optional research question for AI analysis'),
	includeComments: z
		.boolean()
		.optional()
		.describe(
			'When true, include issue comments and PR review threads (gh-cli only). Default: off (a discovery hint is shown instead).',
		),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			'Wall-clock budget in milliseconds for the research subagent (only used when `query` is set). Defaults to 180000 (3 min). Use a larger value for large pages or complex queries.',
		),
};

export interface WebfetchMcpDependencies {
	webfetchResearch: typeof webfetchResearch;
}

// fallow-ignore-next-line unused-exports
export const defaultWebfetchMcpDependencies: WebfetchMcpDependencies = {
	webfetchResearch,
};

function resultText(result: FetchResult): string {
	return result.content.map((item) => item.text).join('\n');
}

function toToolResult(result: FetchResult): CallToolResult {
	const { url, status, processedAs, contentType, cached, truncated } = result.details;

	return {
		content: [{ type: 'text', text: resultText(result) }],
		structuredContent: {
			url,
			status,
			processedAs,
			contentType,
			...(cached !== undefined ? { cached } : {}),
			...(truncated !== undefined ? { truncated } : {}),
		},
		_meta: {
			details: result.details,
		},
		isError: result.details.processedAs === 'error',
	};
}

// fallow-ignore-next-line unused-exports
export function registerWebfetchMcpTools(
	server: McpServer,
	deps: WebfetchMcpDependencies = defaultWebfetchMcpDependencies,
): void {
	server.registerTool(
		'webfetch',
		{
			title: 'Web Fetch',
			description: 'Fetch and process web pages from URLs, optionally with a research query',
			inputSchema: webfetchInputSchema,
		},
		async ({ url, query, includeComments, timeout }) =>
			toToolResult(
				await deps.webfetchResearch(
					url,
					query,
					undefined,
					undefined,
					undefined,
					undefined,
					includeComments !== undefined ? { github: { includeComments } } : undefined,
					() => Date.now(),
					undefined,
					'mcp',
					timeout,
				),
			),
	);
}

export function createWebfetchMcpServer(
	deps: WebfetchMcpDependencies = defaultWebfetchMcpDependencies,
): McpServer {
	const server = new McpServer({
		name: 'pi-webfetch',
		version: '0.2.1',
	});

	registerWebfetchMcpTools(server, deps);
	return server;
}