/**
 * Stdio MCP server entrypoint for Codex plugin support.
 */

import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWebfetchMcpServer } from './mcp-tools.js';

export async function main(): Promise<void> {
	const server = createWebfetchMcpServer();
	await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	});
}
