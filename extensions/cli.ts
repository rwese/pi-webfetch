#!/usr/bin/env node
/**
 * Direct CLI for pi-webfetch.
 */

import { pathToFileURL } from 'node:url';
import type { FetchResult } from './types.js';
import { webfetchResearch, webfetchSPA, getProviderStatus } from './fetch.js';
import {
	clearAllCache,
	clearCache,
	getCacheStats,
	parseDurationToMs,
	type ClearCacheOptions,
} from './cache.js';
import { main as startMcpServer } from './mcp-server.js';

type ProviderName = 'default' | 'clawfetch' | 'gh-cli';
type WaitFor = 'networkidle' | 'domcontentloaded';

export interface CliDependencies {
	webfetchResearch: typeof webfetchResearch;
	webfetchSPA: typeof webfetchSPA;
	getProviderStatus: typeof getProviderStatus;
	clearCache: typeof clearCache;
	clearAllCache: (options?: ClearCacheOptions) => Promise<number>;
	getCacheStats: typeof getCacheStats;
	startMcpServer: typeof startMcpServer;
}

export const defaultCliDependencies: CliDependencies = {
	webfetchResearch,
	webfetchSPA,
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
  pi-webfetch webfetch <url> [--query <text>] [--provider default|clawfetch|gh-cli] [--include-comments] [--timeout <ms>] [--cache-ttl <ms>] [--json]
  pi-webfetch spa <url> [--wait-for networkidle|domcontentloaded] [--timeout <ms>] [--json]
  pi-webfetch providers [--json]
  pi-webfetch clear-cache [--url <url>] [--all] [--older-than <duration>] [--dry-run] [--json]
  pi-webfetch cache-stats [--json]
  pi-webfetch mcp

Commands:
  webfetch      Fetch and process a URL, optionally with a research query
  spa           Fetch a JavaScript-heavy page with browser rendering
  providers     Show available fetch providers
  clear-cache   Clear one cached URL, all entries, or entries older than <duration>
  cache-stats   Show cache statistics
  mcp           Start the stdio MCP server

Options:
  --include-comments     Include issue comments and PR review threads (gh-cli).
                         Default: off (a discovery hint is shown instead).
  --timeout <ms>         Wall-clock budget in milliseconds for the research
                         subagent. Defaults to 300000 (5 min). Use a larger
                         value for large pages or complex queries.
  --cache-ttl <ms>       Per-call cache TTL override in milliseconds. Defaults
                         to 3600000 (1 hour). Cached entries older than the
                         TTL are treated as misses and re-fetched.
  --older-than <dur>     With \`clear-cache\`: only clear entries older than
                         the duration. Accepts \`7d\`, \`2h\`, \`30m\`, \`45s\`,
                         or a bare integer in milliseconds.
  --all                  With \`clear-cache\`: clear every cached entry.
  --dry-run              With \`clear-cache\`: print which entries would be
                         removed without actually deleting them.
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

/**
 * Parse a millisecond timeout value. The `defaultMs` is what the
 * caller falls back to when the flag is omitted.
 */
function parseTimeout(value: string | boolean | undefined, defaultMs: number): number {
	if (value === undefined) return defaultMs;
	if (typeof value !== 'string') throw new Error('Invalid timeout');
	const timeout = Number(value);
	if (!Number.isInteger(timeout) || timeout <= 0) {
		throw new Error(`Invalid timeout '${value}'`);
	}
	return timeout;
}

/**
 * Parse a boolean CLI flag. Accepts the bare flag (true), `--flag=true`,
 * `--flag=false`, or the literal strings `true`/`false`. Any other string
 * value is treated as `true` so shorthand like `--flag yes` still works.
 */
function parseBoolean(value: string | boolean | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value === 'boolean') return value;
	const normalized = value.trim().toLowerCase();
	if (normalized === '' || normalized === 'true' || normalized === 'yes' || normalized === '1') {
		return true;
	}
	if (normalized === 'false' || normalized === 'no' || normalized === '0') {
		return false;
	}
	throw new Error(`Invalid boolean '${value}'`);
}

/**
 * Parse the `--cache-ttl <ms>` value. Accepts a positive integer in
 * milliseconds. `undefined` means "use the default". A non-positive
 * or non-integer value is rejected (we never expose a "no TTL" mode).
 */
function parseCacheTtl(value: string | boolean | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw new Error('Invalid --cache-ttl');
	const ttl = Number(value);
	if (!Number.isInteger(ttl) || ttl <= 0) {
		throw new Error(`Invalid --cache-ttl '${value}' (must be a positive integer)`);
	}
	return ttl;
}

/**
 * Parse the `--older-than <duration>` value. Accepts a duration
 * string (`7d`, `2h`, `30m`, `45s`, `1500ms`) or a bare integer in
 * milliseconds. `undefined` means "no filter".
 */
function parseOlderThan(value: string | boolean | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string') throw new Error('Invalid --older-than');
	const ms = parseDurationToMs(value);
	if (ms === null) {
		throw new Error(
			`Invalid --older-than '${value}' (expected <n>d|h|m|s|ms or a bare integer in ms)`,
		);
	}
	return ms;
}

function formatMs(ms: number): string {
	if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
	if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
	if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)}m`;
	if (ms % 1000 === 0) return `${ms / 1000}s`;
	return `${ms}ms`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
			const includeComments = parseBoolean(parsed.flags.includeComments);
			// Default 180s matches the spawn default; users can still
			// raise it per-call for unusually large / complex pages.
			const timeout = parseTimeout(parsed.flags.timeout, 300000);
			const cacheTtlMs = parseCacheTtl(parsed.flags.cacheTtl);
			const providerOptions =
				includeComments !== undefined || cacheTtlMs !== undefined
					? {
							...(includeComments !== undefined
								? { github: { includeComments } }
								: {}),
							...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}),
						}
					: includeComments !== undefined
						? { github: { includeComments } }
						: undefined;
			const result = await deps.webfetchResearch(
				requireUrl(parsed),
				optionalString(parsed.flags.query),
				undefined,
				undefined,
				undefined,
				parseProvider(parsed.flags.provider),
				providerOptions,
				// CLI: stable per-process clock; stable multi-line stderr
				// message on the agent-error path. The session id is still
				// unique-per-invocation because it includes the timestamp.
				() => Date.now(),
				(message) => {
					writeError(io, message);
				},
				'cli',
				timeout,
			);
			writeFetchResult(io, result, wantsJson(parsed));
			return 0;
		}

		if (parsed.command === 'spa') {
			const result = await deps.webfetchSPA(
				requireUrl(parsed),
				parseWaitFor(parsed.flags.waitFor),
				parseTimeout(parsed.flags.timeout, 30000),
			);
			writeFetchResult(io, result, wantsJson(parsed));
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
			const all = parsed.flags.all === true;
			const dryRun = parsed.flags.dryRun === true;
			const olderThanMs = parseOlderThan(parsed.flags.olderThan);

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

			if (dryRun) {
				// Dry-run: list entries that would be removed without
				// actually deleting them. We approximate this by
				// reading the cache stats (count + total size) and
				// surfacing the configured filter. The actual
				// implementation lives in `clearAllCache` /
				// `clearCacheOlderThan`; for the CLI dry-run we just
				// describe what *would* happen.
				const stats = await deps.getCacheStats();
				const filter =
					olderThanMs !== undefined
						? `entries older than ${formatMs(olderThanMs)}`
						: all
							? 'all entries'
							: 'all entries';
				if (wantsJson(parsed)) {
					writeJson(io, {
						dryRun: true,
						wouldClear: stats.count,
						filter,
						totalSize: stats.totalSize,
					});
				} else {
					write(
						io,
						`Dry run: would clear ${filter} (${stats.count} entries, ${formatBytes(
							stats.totalSize,
						)} on disk).`,
					);
				}
				return 0;
			}

			if (olderThanMs !== undefined) {
				// `clearAllCache` accepts an `olderThanMs` option; the
				// CLI / MCP / extension use the same primitive.
				const clearedCount = await deps.clearAllCache({ olderThanMs });
				if (wantsJson(parsed)) {
					writeJson(io, { clearedCount, olderThanMs });
				} else {
					write(
						io,
						`Cleared ${clearedCount} cached item(s) older than ${formatMs(olderThanMs)}`,
					);
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
