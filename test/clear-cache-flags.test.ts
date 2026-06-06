/**
 * Clear-cache flags tests
 *
 * Regression for the 2026-06-06 review (finding 11):
 * `webfetch-clear-cache` was per-URL only; no batch UX. The
 * v0.9.0 fix adds `--all`, `--older-than <duration>`, and
 * `--dry-run` flags. These tests pin the CLI and the
 * underlying `clearAllCache` / `clearCacheOlderThan` helpers.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const clearAllCacheMock = vi.hoisted(() => vi.fn());
const clearCacheOlderThanMock = vi.hoisted(() => vi.fn());
const clearCacheMock = vi.hoisted(() => vi.fn());
const getCacheStatsMock = vi.hoisted(() => vi.fn());

vi.mock('../extensions/services/webfetch-research.js', () => ({}));
vi.mock('../extensions/fetch.js', () => ({
	webfetchResearch: vi.fn(),
	webfetchSPA: vi.fn(),
	getProviderStatus: vi.fn(),
}));

vi.mock('../extensions/cache.js', () => ({
	getCache: async () => null,
	setCache: async () => undefined,
	hasCache: async () => false,
	getCacheAge: async () => null,
	clearCache: clearCacheMock,
	clearCacheOlderThan: clearCacheOlderThanMock,
	clearAllCache: clearAllCacheMock,
	getCacheStats: getCacheStatsMock,
	formatAge: () => '0 seconds ago',
	isFresh: () => true,
	parseDurationToMs: (v: string) => {
		const m = /^(\d+)(ms|s|m|h|d)?$/i.exec(v.trim());
		if (!m) return null;
		const n = Number(m[1]);
		const u = (m[2] ?? 'ms').toLowerCase();
		return (
			u === 'ms' ? n :
			u === 's'  ? n * 1000 :
			u === 'm'  ? n * 60_000 :
			u === 'h'  ? n * 3_600_000 :
			u === 'd'  ? n * 86_400_000 :
			null
		);
	},
	DEFAULT_CACHE_TTL_MS: 3_600_000,
}));

vi.mock('../extensions/mcp-server.js', () => ({
	main: vi.fn(),
}));

import { runCli } from '../extensions/cli.js';

beforeEach(() => {
	clearAllCacheMock.mockReset();
	clearCacheOlderThanMock.mockReset();
	clearCacheMock.mockReset();
	getCacheStatsMock.mockReset();
	clearAllCacheMock.mockResolvedValue(0);
	clearCacheOlderThanMock.mockResolvedValue(false);
	clearCacheMock.mockResolvedValue(true);
	getCacheStatsMock.mockResolvedValue({ count: 0, totalSize: 0 });
});

function createIo(): {
	stdoutText: () => string;
	stderrText: () => string;
	stdout: { write: (s: string) => unknown };
	stderr: { write: (s: string) => unknown };
} {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	return {
		stdout: { write: (s: string) => stdoutChunks.push(s) },
		stderr: { write: (s: string) => stderrChunks.push(s) },
		stdoutText: () => stdoutChunks.join(''),
		stderrText: () => stderrChunks.join(''),
	};
}

describe('webfetch-clear-cache --all', () => {
	it('clears every entry (no filter)', async () => {
		clearAllCacheMock.mockResolvedValue(7);
		const io = createIo();

		const exitCode = await runCli(['clear-cache'], undefined, io);
		expect(exitCode).toBe(0);
		expect(clearAllCacheMock).toHaveBeenCalledWith();
		expect(io.stdoutText()).toBe('Cleared 7 cached item(s)\n');
	});

	it('clears every entry with the explicit --all flag', async () => {
		clearAllCacheMock.mockResolvedValue(3);
		const io = createIo();

		const exitCode = await runCli(['clear-cache', '--all'], undefined, io);
		expect(exitCode).toBe(0);
		expect(clearAllCacheMock).toHaveBeenCalledWith();
	});
});

describe('webfetch-clear-cache --older-than <duration>', () => {
	it('parses `7d` and forwards the ms to clearAllCache', async () => {
		clearAllCacheMock.mockResolvedValue(2);
		const io = createIo();

		const exitCode = await runCli(['clear-cache', '--older-than', '7d'], undefined, io);
		expect(exitCode).toBe(0);
		expect(clearAllCacheMock).toHaveBeenCalledWith({ olderThanMs: 7 * 24 * 60 * 60 * 1000 });
		expect(io.stdoutText()).toContain('older than 7d');
	});

	it('parses `2h`, `30m`, `45s`', async () => {
		clearAllCacheMock.mockResolvedValue(1);
		const io = createIo();

		await runCli(['clear-cache', '--older-than', '2h'], undefined, io);
		expect(clearAllCacheMock).toHaveBeenLastCalledWith({
			olderThanMs: 2 * 60 * 60 * 1000,
		});

		await runCli(['clear-cache', '--older-than', '30m'], undefined, io);
		expect(clearAllCacheMock).toHaveBeenLastCalledWith({
			olderThanMs: 30 * 60 * 1000,
		});

		await runCli(['clear-cache', '--older-than', '45s'], undefined, io);
		expect(clearAllCacheMock).toHaveBeenLastCalledWith({
			olderThanMs: 45 * 1000,
		});
	});

	it('parses bare integers as ms', async () => {
		clearAllCacheMock.mockResolvedValue(1);
		const io = createIo();

		await runCli(['clear-cache', '--older-than', '1500'], undefined, io);
		expect(clearAllCacheMock).toHaveBeenLastCalledWith({ olderThanMs: 1500 });
	});

	it('rejects malformed durations', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['clear-cache', '--older-than', 'banana'],
			undefined,
			io,
		);
		expect(exitCode).toBe(1);
		expect(io.stderrText()).toContain('Invalid --older-than');
	});
});

describe('webfetch-clear-cache --dry-run', () => {
	it('does not call clearAllCache / clearCache', async () => {
		getCacheStatsMock.mockResolvedValue({ count: 4, totalSize: 4096 });
		const io = createIo();

		const exitCode = await runCli(['clear-cache', '--dry-run'], undefined, io);
		expect(exitCode).toBe(0);
		expect(clearAllCacheMock).not.toHaveBeenCalled();
		expect(clearCacheMock).not.toHaveBeenCalled();
		expect(io.stdoutText()).toContain('Dry run');
		expect(io.stdoutText()).toContain('4 entries');
	});

	it('combines with --older-than to describe the filter', async () => {
		getCacheStatsMock.mockResolvedValue({ count: 0, totalSize: 0 });
		const io = createIo();

		const exitCode = await runCli(
			['clear-cache', '--dry-run', '--older-than', '7d'],
			undefined,
			io,
		);
		expect(exitCode).toBe(0);
		expect(clearAllCacheMock).not.toHaveBeenCalled();
		expect(io.stdoutText()).toContain('older than 7d');
	});

	it('emits a JSON-shaped dry-run summary with --json', async () => {
		getCacheStatsMock.mockResolvedValue({ count: 2, totalSize: 2048 });
		const io = createIo();

		const exitCode = await runCli(
			['clear-cache', '--dry-run', '--all', '--json'],
			undefined,
			io,
		);
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(io.stdoutText());
		expect(parsed.dryRun).toBe(true);
		expect(parsed.wouldClear).toBe(2);
		expect(parsed.totalSize).toBe(2048);
	});
});

describe('webfetch-clear-cache --url <url> (unchanged)', () => {
	it('still clears a single URL when --url is provided', async () => {
		clearCacheMock.mockResolvedValue(true);
		const io = createIo();

		const exitCode = await runCli(
			['clear-cache', '--url', 'https://example.com'],
			undefined,
			io,
		);
		expect(exitCode).toBe(0);
		expect(clearCacheMock).toHaveBeenCalledWith('https://example.com');
		expect(io.stdoutText()).toContain('Cache cleared for: https://example.com');
	});
});
