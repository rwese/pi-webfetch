import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseArgs, runCli, type CliDependencies, type CliIO } from '../extensions/cli.js';

const execFileAsync = promisify(execFile);

function createIo(): {
	io: CliIO;
	stdoutText: () => string;
	stderrText: () => string;
} {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const io = {
		stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
		stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
	};
	return {
		io,
		stdoutText: () => stdoutChunks.join(''),
		stderrText: () => stderrChunks.join(''),
	};
}

function createDeps(): CliDependencies {
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
		webfetchSPA: vi.fn(async (url: string) => ({
			content: [{ type: 'text' as const, text: `spa ${url}` }],
			details: {
				url,
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa' as const,
			},
		})),
		getProviderStatus: vi.fn(async () => [
			{ name: 'default', available: true, priority: 10 },
			{ name: 'clawfetch', available: false, priority: 5 },
		]),
		clearCache: vi.fn(async () => true),
		clearAllCache: vi.fn(async () => 2),
		getCacheStats: vi.fn(async () => ({ count: 1, totalSize: 512 })),
		startMcpServer: vi.fn(async () => undefined),
	};
}

describe('CLI parser', () => {
	it('parses subcommands, positional args, and flags', () => {
		expect(
			parseArgs([
				'webfetch',
				'https://example.com',
				'--query',
				'Summarize',
				'--provider=gh-cli',
				'--json',
			]),
		).toEqual({
			command: 'webfetch',
			args: ['https://example.com'],
			flags: {
				query: 'Summarize',
				provider: 'gh-cli',
				json: true,
			},
		});
	});
});

describe('runCli', () => {
	it('delegates webfetch and writes JSON output', async () => {
		const deps = createDeps();
		const { io, stdoutText, stderrText } = createIo();
		const exitCode = await runCli(
			[
				'webfetch',
				'https://example.com',
				'--query',
				'Summarize',
				'--provider',
				'gh-cli',
				'--json',
			],
			deps,
			io,
		);

		expect(exitCode).toBe(0);
		expect(stderrText()).toBe('');
		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://example.com',
			'Summarize',
			undefined,
			undefined,
			undefined,
			'gh-cli',
			undefined,
			expect.any(Function),
			expect.any(Function),
			'cli',
			180000,
		);
		expect(JSON.parse(stdoutText())).toEqual({
			content: [{ type: 'text', text: 'fetched https://example.com' }],
			details: {
				url: 'https://example.com',
				contentType: 'text/html',
				status: 200,
				processedAs: 'spa',
			},
		});
	});

	it('delegates provider, cache, and MCP commands', async () => {
		const deps = createDeps();
		const { io, stdoutText } = createIo();

		expect(await runCli(['providers'], deps, io)).toBe(0);
		expect(await runCli(['clear-cache', '--url', 'https://example.com'], deps, io)).toBe(0);
		expect(await runCli(['cache-stats', '--json'], deps, io)).toBe(0);
		expect(await runCli(['mcp'], deps, io)).toBe(0);

		expect(deps.getProviderStatus).toHaveBeenCalled();
		expect(deps.clearCache).toHaveBeenCalledWith('https://example.com');
		expect(deps.getCacheStats).toHaveBeenCalled();
		expect(deps.startMcpServer).toHaveBeenCalled();
		expect(stdoutText()).toContain('| default | Available | 10 |');
	});

	it('reports a cache miss when clearing an uncached URL', async () => {
		const deps = createDeps();
		(deps.clearCache as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
		const { io, stdoutText } = createIo();

		const exitCode = await runCli(['clear-cache', '--url', 'https://missing.example'], deps, io);

		expect(exitCode).toBe(0);
		expect(stdoutText()).toBe('No cache entry found for: https://missing.example\n');
	});

	it('prints cache stats after clearing all cached content', async () => {
		const deps = createDeps();
		(deps.getCacheStats as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ count: 0, totalSize: 0 });
		const { io, stdoutText } = createIo();

		expect(await runCli(['clear-cache'], deps, io)).toBe(0);
		expect(await runCli(['cache-stats'], deps, io)).toBe(0);

		expect(stdoutText()).toContain('Cleared 2 cached item(s)');
		expect(stdoutText()).toContain('Cached items: 0');
		expect(stdoutText()).toContain('Total size: 0.00 MB');
	});

	it('writes errors to stderr and exits non-zero', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();
		const exitCode = await runCli(['webfetch'], deps, io);

		expect(exitCode).toBe(1);
		expect(stderrText()).toBe("Missing required URL for 'webfetch'\n");
	});

	it('forwards --include-comments to webfetchResearch', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();
		const exitCode = await runCli(
			['webfetch', 'https://github.com/foo/bar/issues/1', '--include-comments'],
			deps,
			io,
		);

		expect(exitCode).toBe(0);
		expect(stderrText()).toBe('');
		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://github.com/foo/bar/issues/1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ github: { includeComments: true } },
			expect.any(Function),
			expect.any(Function),
			'cli',
			180000,
		);
	});

	it('forwards --include-comments=false as an explicit false option', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();
		const exitCode = await runCli(
			['webfetch', 'https://github.com/foo/bar/issues/1', '--include-comments=false'],
			deps,
			io,
		);

		expect(exitCode).toBe(0);
		expect(stderrText()).toBe('');
		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://github.com/foo/bar/issues/1',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ github: { includeComments: false } },
			expect.any(Function),
			expect.any(Function),
			'cli',
			180000,
		);
	});

	it('omits github options when --include-comments is not provided', async () => {
		const deps = createDeps();
		const { io } = createIo();
		await runCli(['webfetch', 'https://github.com/foo/bar/issues/1'], deps, io);

		const lastCall = (deps.webfetchResearch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
		expect(lastCall?.[6]).toBeUndefined();
	});

	it('writes the resume hint to stderr on the agent-error path', async () => {
		const deps = createDeps();
		// Replace the webfetchResearch mock so it returns an error fallback
		// (the same shape webfetchResearch produces on the agent-error
		// branch) and invokes the notify shim synchronously.
		(deps.webfetchResearch as ReturnType<typeof vi.fn>).mockImplementation(
			async (
				_url: string,
				_query: string | undefined,
				_fetch?: typeof fetch,
				_status?: unknown,
				_streaming?: unknown,
				_provider?: string,
				_options?: unknown,
				_now?: () => number,
				notify?: (message: string, level: 'info' | 'warn' | 'error') => void,
				_source?: string,
			) => {
				notify?.(
					[
						'Research subagent failed.',
						'Subagent session: 0123456789abcdef',
						"Re-run: pi-webfetch webfetch 'https://example.com' --query 'q'",
						'Reason: boom',
					].join('\n'),
					'error',
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: "## Fetch Result (Agent Error)\n**Command:** /webfetch https://example.com \"q\"\n**Agent Error:** boom\n\n---\n\nbody",
						},
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
					},
				};
			},
		);

		const { io, stderrText, stdoutText } = createIo();
		const exitCode = await runCli(
			['webfetch', 'https://example.com', '--query', 'q'],
			deps,
			io,
		);

		expect(exitCode).toBe(0);
		const stderr = stderrText();
		expect(stderr).toContain('Research subagent failed.');
		expect(stderr).toContain('Subagent session: 0123456789abcdef');
		expect(stderr).toContain('Re-run: pi-webfetch webfetch');
		expect(stderr).toContain('Reason: boom');
		// Fallback markdown is still on stdout
		expect(stdoutText()).toContain('## Fetch Result (Agent Error)');
		expect(stdoutText()).toContain('boom');
	});

	it('rejects invalid --include-comments values', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();
		const exitCode = await runCli(
			['webfetch', 'https://github.com/foo/bar/issues/1', '--include-comments=maybe'],
			deps,
			io,
		);

		expect(exitCode).toBe(1);
		expect(stderrText()).toContain("Invalid boolean 'maybe'");
	});

	it('forwards --timeout <ms> to webfetchResearch', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();
		const exitCode = await runCli(
			['webfetch', 'https://example.com', '--query', 'q', '--timeout', '300000'],
			deps,
			io,
		);

		expect(exitCode).toBe(0);
		expect(stderrText()).toBe('');
		expect(deps.webfetchResearch).toHaveBeenCalledWith(
			'https://example.com',
			'q',
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			expect.any(Function),
			expect.any(Function),
			'cli',
			300000,
		);
	});

	it('rejects non-positive --timeout values', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();

		expect(
			await runCli(
				['webfetch', 'https://example.com', '--timeout', '0'],
				deps,
				io,
			),
		).toBe(1);
		expect(
			await runCli(
				['webfetch', 'https://example.com', '--timeout', '-5'],
				deps,
				io,
			),
		).toBe(1);
		expect(
			await runCli(
				['webfetch', 'https://example.com', '--timeout', 'abc'],
				deps,
				io,
			),
		).toBe(1);
		expect(stderrText()).toContain('Invalid timeout');
	});
});

describe('compiled CLI', () => {
	beforeAll(async () => {
		await execFileAsync('npm', ['run', 'build'], {
			cwd: '/Users/wese/Repos/github.com/rwese/pi-webfetch',
		});
	});

	it('prints help', async () => {
		const { stdout, stderr } = await execFileAsync(
			'node',
			['dist/extensions/cli.js', '--help'],
			{ cwd: '/Users/wese/Repos/github.com/rwese/pi-webfetch' },
		);

		expect(stderr).toBe('');
		expect(stdout).toContain('pi-webfetch webfetch <url>');
		expect(stdout).toContain('--include-comments');
		expect(stdout).toContain('--timeout');
		expect(stdout).toContain('pi-webfetch mcp');
	});

	it('runs providers with JSON output', async () => {
		const { stdout, stderr } = await execFileAsync(
			'node',
			['dist/extensions/cli.js', 'providers', '--json'],
			{ cwd: '/Users/wese/Repos/github.com/rwese/pi-webfetch' },
		);

		expect(stderr).toBe('');
		expect(JSON.parse(stdout)).toHaveProperty('providers');
	});

	it('runs webfetch with JSON output', async () => {
		const { stdout, stderr } = await execFileAsync(
			'node',
			['dist/extensions/cli.js', 'webfetch', 'https://raw.githubusercontent.com/', '--json'],
			{ cwd: '/Users/wese/Repos/github.com/rwese/pi-webfetch' },
		);

		expect(stderr).toBe('');
		const result = JSON.parse(stdout);
		expect(result.content[0].type).toBe('text');
		expect(result.details.url).toBe('https://raw.githubusercontent.com/');
	});

	it('runs webfetch without flags as deterministic plain-text output', async () => {
		const { stdout, stderr } = await execFileAsync(
			'node',
			['dist/extensions/cli.js', 'webfetch', 'https://raw.githubusercontent.com/'],
			{ cwd: '/Users/wese/Repos/github.com/rwese/pi-webfetch' },
		);

		expect(stderr).toBe('');
		expect(stdout.length).toBeGreaterThan(0);
		expect(() => JSON.parse(stdout)).toThrow();
	});

	it('starts MCP mode without non-protocol stdout', async () => {
		const proc = spawn('node', ['dist/extensions/cli.js', 'mcp'], {
			cwd: '/Users/wese/Repos/github.com/rwese/pi-webfetch',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		await new Promise((resolve) => setTimeout(resolve, 250));
		proc.kill('SIGTERM');
		await once(proc, 'close');

		expect(stdout).toBe('');
		expect(stderr).toBe('');
	});
});

describe('MCP package config', () => {
	it('uses the package-runnable MCP command', async () => {
		const config = JSON.parse(
			await readFile('/Users/wese/Repos/github.com/rwese/pi-webfetch/.mcp.json', 'utf-8'),
		);

		expect(config.mcpServers['pi-webfetch']).toEqual({
			command: 'npx',
			args: ['-y', '@rwese/pi-webfetch', 'mcp'],
		});
	});
});
