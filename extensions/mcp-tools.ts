/**
 * MCP tool registration for Codex plugin support.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type { FetchResult } from './types.js';
import { webfetchResearch } from './fetch.js';
import { clearAllCache, clearCache } from './cache.js';

const providerSchema = z.enum(['default', 'clawfetch', 'gh-cli']);

const webfetchInputSchema = {
	url: z.string().url().describe('The URL to fetch'),
	query: z.string().optional().describe('Optional research question for AI analysis'),
	provider: providerSchema.optional().describe('Force a specific provider'),
};

const clearCacheInputSchema = {
	url: z.string().url().optional().describe('Specific URL to clear; omit to clear all cache'),
};

export interface WebfetchMcpDependencies {
	webfetchResearch: typeof webfetchResearch;
	clearCache: typeof clearCache;
	clearAllCache: typeof clearAllCache;
}

export const defaultWebfetchMcpDependencies: WebfetchMcpDependencies = {
	webfetchResearch,
	clearCache,
	clearAllCache,
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

function toTextToolResult(
	text: string,
	structuredContent?: Record<string, unknown>,
): CallToolResult {
	return {
		content: [{ type: 'text', text }],
		...(structuredContent ? { structuredContent } : {}),
	};
}

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
		async ({ url, query, provider }) =>
			toToolResult(
				await deps.webfetchResearch(url, query, undefined, undefined, undefined, provider),
			),
	);

	server.registerTool(
		'webfetch-clear-cache',
		{
			title: 'Clear Web Fetch Cache',
			description: 'Clear cached content for a specific URL, or all cached content',
			inputSchema: clearCacheInputSchema,
		},
		async ({ url }) => {
			if (url) {
				const cleared = await deps.clearCache(url);
				return toTextToolResult(
					cleared ? `Cache cleared for: ${url}` : `No cache entry found for: ${url}`,
					{ url, cleared },
				);
			}

			const clearedCount = await deps.clearAllCache();
			return toTextToolResult(`Cleared ${clearedCount} cached item(s)`, { clearedCount });
		},
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
