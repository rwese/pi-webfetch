/** OpenCode custom-tool adapter for pi-webfetch. */

import { z } from 'zod/v4';
import type { FetchResult } from './types.js';
import { webfetchResearch } from './fetch.js';

export const OPENCODE_WEBFETCH_ARGS = {
	url: z.string().url().describe('The URL to fetch'),
	query: z.string().optional().describe('Optional research question for AI analysis'),
	includeComments: z
		.boolean()
		.optional()
		.describe(
			'When true, include issue comments and PR review threads (gh-cli only). Default: off.',
		),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			'Wall-clock budget in milliseconds for the research subagent. Defaults to 300000.',
		),
	cacheTtlMs: z
		.number()
		.int()
		.positive()
		.optional()
		.describe('Per-call cache TTL in milliseconds. Defaults to 3600000.'),
};

export interface OpenCodeWebfetchDependencies {
	webfetchResearch: typeof webfetchResearch;
}

export interface OpenCodeWebfetchContext {
	agent: string;
	sessionID: string;
	messageID: string;
	directory: string;
	worktree: string;
}

export const defaultOpenCodeWebfetchDependencies: OpenCodeWebfetchDependencies = {
	webfetchResearch,
};

function resultText(result: FetchResult): string {
	return result.content.map((item) => item.text).join('\n');
}

export function createOpenCodeWebfetchTool(
	deps: OpenCodeWebfetchDependencies = defaultOpenCodeWebfetchDependencies,
) {
	return {
		description: 'Fetch and process web pages from URLs, optionally with a research query',
		args: OPENCODE_WEBFETCH_ARGS,
		async execute(
			args: {
				url: string;
				query?: string;
				includeComments?: boolean;
				timeout?: number;
				cacheTtlMs?: number;
			},
			_context: OpenCodeWebfetchContext,
		): Promise<string> {
			const options =
				args.includeComments !== undefined || args.cacheTtlMs !== undefined
					? {
							...(args.includeComments !== undefined
								? { github: { includeComments: args.includeComments } }
								: {}),
							...(args.cacheTtlMs !== undefined
								? { cacheTtlMs: args.cacheTtlMs }
								: {}),
						}
					: undefined;

			return resultText(
				await deps.webfetchResearch(
					args.url,
					args.query,
					undefined,
					undefined,
					undefined,
					undefined,
					options,
					() => Date.now(),
					undefined,
					'mcp',
					args.timeout,
				),
			);
		},
	};
}

export default createOpenCodeWebfetchTool();
