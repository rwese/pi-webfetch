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
		downloadFile: vi.fn(async () => ({
			tempPath: '/tmp/webfetch-download.txt',
			contentType: 'text/plain',
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

	it('delegates provider, cache, download, and MCP commands', async () => {
		const deps = createDeps();
		const { io, stdoutText } = createIo();

		expect(await runCli(['providers'], deps, io)).toBe(0);
		expect(await runCli(['clear-cache', '--url', 'https://example.com'], deps, io)).toBe(0);
		expect(await runCli(['cache-stats', '--json'], deps, io)).toBe(0);
		expect(await runCli(['download', 'https://example.com/file.txt'], deps, io)).toBe(0);
		expect(await runCli(['mcp'], deps, io)).toBe(0);

		expect(deps.getProviderStatus).toHaveBeenCalled();
		expect(deps.clearCache).toHaveBeenCalledWith('https://example.com');
		expect(deps.getCacheStats).toHaveBeenCalled();
		expect(deps.downloadFile).toHaveBeenCalledWith('https://example.com/file.txt');
		expect(deps.startMcpServer).toHaveBeenCalled();
		expect(stdoutText()).toContain('| default | Available | 10 |');
		expect(stdoutText()).toContain('File saved to: /tmp/webfetch-download.txt');
	});

	it('writes errors to stderr and exits non-zero', async () => {
		const deps = createDeps();
		const { io, stderrText } = createIo();
		const exitCode = await runCli(['webfetch'], deps, io);

		expect(exitCode).toBe(1);
		expect(stderrText()).toBe("Missing required URL for 'webfetch'\n");
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
