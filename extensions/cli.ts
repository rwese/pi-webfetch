#!/usr/bin/env node
/**
 * Direct CLI for pi-webfetch.
 */

import { pathToFileURL } from 'node:url';
import type { FetchResult } from './types.js';
import { webfetchResearch, webfetchSPA, downloadFile, getProviderStatus } from './fetch.js';
import { clearAllCache, clearCache, getCacheStats } from './cache.js';
import { main as startMcpServer } from './mcp-server.js';

type ProviderName = 'default' | 'clawfetch' | 'gh-cli';
type WaitFor = 'networkidle' | 'domcontentloaded';

export interface CliDependencies {
	webfetchResearch: typeof webfetchResearch;
	webfetchSPA: typeof webfetchSPA;
	downloadFile: typeof downloadFile;
	getProviderStatus: typeof getProviderStatus;
	clearCache: typeof clearCache;
	clearAllCache: typeof clearAllCache;
	getCacheStats: typeof getCacheStats;
	startMcpServer: typeof startMcpServer;
}

export const defaultCliDependencies: CliDependencies = {
	webfetchResearch,
	webfetchSPA,
	downloadFile,
	getProviderStatus,
	clearCache,
	clearAllCache,
	getCacheStats,
	startMcpServer,
};

export interface CliIO {
	stdout: { write: (text: string) => unknown };
	stderr: { write: (text: string) => unknown };
}

export interface ParsedCommand {
	command: string;
	args: string[];
	flags: Record<string, string | boolean>;
}

const helpText = `pi-webfetch

Usage:
  pi-webfetch webfetch <url> [--query <text>] [--provider default|clawfetch|gh-cli] [--json]
  pi-webfetch spa <url> [--wait-for networkidle|domcontentloaded] [--timeout <ms>] [--json]
  pi-webfetch download <url> [--json]
  pi-webfetch providers [--json]
  pi-webfetch clear-cache [--url <url>] [--json]
  pi-webfetch cache-stats [--json]
  pi-webfetch mcp

Commands:
  webfetch      Fetch and process a URL, optionally with a research query
  spa           Fetch a JavaScript-heavy page with browser rendering
  download      Download a URL to a temp file
  providers     Show available fetch providers
  clear-cache   Clear one cached URL or all cached content
  cache-stats   Show cache statistics
  mcp           Start the stdio MCP server
`;

function write(io: CliIO, text: string): void {
	io.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function writeError(io: CliIO, text: string): void {
	io.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
}

function parseFlagName(flag: string): string {
	return flag
		.replace(/^--/, '')
		.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function parseArgs(argv: string[]): ParsedCommand {
	const [command = 'help', ...tokens] = argv;
	const args: string[] = [];
	const flags: Record<string, string | boolean> = {};

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token.startsWith('--')) {
			args.push(token);
			continue;
		}

		const [rawName, inlineValue] = token.split(/=(.*)/s, 2);
		const name = parseFlagName(rawName);
		if (inlineValue !== undefined) {
			flags[name] = inlineValue;
			continue;
		}

		const next = tokens[i + 1];
		if (next && !next.startsWith('--')) {
			flags[name] = next;
			i++;
		} else {
			flags[name] = true;
		}
	}

	return { command, args, flags };
}

function requireUrl(parsed: ParsedCommand): string {
	const url = parsed.args[0] ?? parsed.flags.url;
	if (typeof url !== 'string' || !url) {
		throw new Error(`Missing required URL for '${parsed.command}'`);
	}
	return url;
}

function optionalString(value: string | boolean | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parseProvider(value: string | boolean | undefined): ProviderName | undefined {
	if (value === undefined) return undefined;
	if (value === 'default' || value === 'clawfetch' || value === 'gh-cli') return value;
	throw new Error(`Invalid provider '${String(value)}'`);
}

function parseWaitFor(value: string | boolean | undefined): WaitFor {
	if (value === undefined) return 'networkidle';
	if (value === 'networkidle' || value === 'domcontentloaded') return value;
	throw new Error(`Invalid wait strategy '${String(value)}'`);
}

function parseTimeout(value: string | boolean | undefined): number {
	if (value === undefined) return 30000;
	if (typeof value !== 'string') throw new Error('Invalid timeout');
	const timeout = Number(value);
	if (!Number.isInteger(timeout) || timeout <= 0) {
		throw new Error(`Invalid timeout '${value}'`);
	}
	return timeout;
}

function wantsJson(parsed: ParsedCommand): boolean {
	return parsed.flags.json === true;
}

function fetchText(result: FetchResult): string {
	return result.content.map((item) => item.text).join('\n');
}

function writeJson(io: CliIO, value: unknown): void {
	write(io, JSON.stringify(value, null, 2));
}

function writeFetchResult(io: CliIO, result: FetchResult, json: boolean): void {
	if (json) {
		writeJson(io, {
			content: result.content,
			details: result.details,
		});
		return;
	}

	write(io, fetchText(result));
}

function formatProviderStatus(providers: Awaited<ReturnType<typeof getProviderStatus>>): string {
	const lines = [
		'## Web Fetch Providers',
		'',
		'| Provider | Available | Priority |',
		'|----------|-----------|----------|',
	];

	for (const provider of providers.sort((a, b) => b.priority - a.priority)) {
		lines.push(
			`| ${provider.name} | ${provider.available ? 'Available' : 'Not installed'} | ${provider.priority} |`,
		);
	}

	return lines.join('\n');
}

export async function runCli(
	argv: string[],
	deps: CliDependencies = defaultCliDependencies,
	io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
	const parsed = parseArgs(argv);

	try {
		if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
			write(io, helpText);
			return 0;
		}

		if (parsed.command === 'mcp') {
			await deps.startMcpServer();
			return 0;
		}

		if (parsed.command === 'webfetch') {
			const result = await deps.webfetchResearch(
				requireUrl(parsed),
				optionalString(parsed.flags.query),
				undefined,
				undefined,
				undefined,
				parseProvider(parsed.flags.provider),
			);
			writeFetchResult(io, result, wantsJson(parsed));
			return 0;
		}

		if (parsed.command === 'spa') {
			const result = await deps.webfetchSPA(
				requireUrl(parsed),
				parseWaitFor(parsed.flags.waitFor),
				parseTimeout(parsed.flags.timeout),
			);
			writeFetchResult(io, result, wantsJson(parsed));
			return 0;
		}

		if (parsed.command === 'download') {
			const url = requireUrl(parsed);
			const result = await deps.downloadFile(url);
			if (wantsJson(parsed)) {
				writeJson(io, { url, ...result });
			} else {
				write(io, `File saved to: ${result.tempPath}`);
			}
			return 0;
		}

		if (parsed.command === 'providers') {
			const providers = await deps.getProviderStatus();
			if (wantsJson(parsed)) {
				writeJson(io, { providers });
			} else {
				write(io, formatProviderStatus(providers));
			}
			return 0;
		}

		if (parsed.command === 'clear-cache') {
			const url = optionalString(parsed.flags.url);
			if (url) {
				const cleared = await deps.clearCache(url);
				const text = cleared
					? `Cache cleared for: ${url}`
					: `No cache entry found for: ${url}`;
				if (wantsJson(parsed)) {
					writeJson(io, { url, cleared });
				} else {
					write(io, text);
				}
				return 0;
			}

			const clearedCount = await deps.clearAllCache();
			if (wantsJson(parsed)) {
				writeJson(io, { clearedCount });
			} else {
				write(io, `Cleared ${clearedCount} cached item(s)`);
			}
			return 0;
		}

		if (parsed.command === 'cache-stats') {
			const stats = await deps.getCacheStats();
			if (wantsJson(parsed)) {
				writeJson(io, stats);
			} else {
				const sizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
				write(io, `Cached items: ${stats.count}\nTotal size: ${sizeMB} MB`);
			}
			return 0;
		}

		throw new Error(`Unknown command '${parsed.command}'`);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		writeError(io, message);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const exitCode = await runCli(process.argv.slice(2));
	process.exitCode = exitCode;
}
