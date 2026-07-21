import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWebfetchConfig, saveWebfetchConfig } from '../extensions/model-config.js';
import {
	filterModelItems,
	registerWebfetchModelCommand,
	USE_PI_DEFAULT_MODEL,
} from '../extensions/commands/webfetch-model-command.js';

const tempDirs: string[] = [];

function tempConfigPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-webfetch-command-'));
	tempDirs.push(dir);
	return join(dir, 'pi-webfetch.json');
}

afterEach(async () => {
	const { rm } = await import('node:fs/promises');
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function captureHandler(configPath: string) {
	let commandName = '';
	let commandOptions:
		| {
				description?: string;
				handler: (args: string, ctx: never) => Promise<void>;
		  }
		| undefined;
	const pi = {
		registerCommand: vi.fn((name: string, options: typeof commandOptions) => {
			commandName = name;
			commandOptions = options;
		}),
	};
	registerWebfetchModelCommand(pi as never, { configPath });
	if (!commandOptions) throw new Error('command was not registered');
	return { commandName, commandOptions };
}

function createContext(selectedValue: string) {
	return {
		waitForIdle: vi.fn(async () => {}),
		modelRegistry: {
			getAvailable: vi.fn(() => [
				{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
				{
					provider: 'openrouter',
					id: 'anthropic/claude-sonnet-4',
					name: 'Claude Sonnet 4',
				},
			]),
		},
		ui: {
			custom: vi.fn(async () => selectedValue),
			notify: vi.fn(),
		},
	};
}

describe('/webfetch:model', () => {
	it('filters models by provider, id, and display name', () => {
		const items = [
			{ value: USE_PI_DEFAULT_MODEL, label: 'Use Pi default model' },
			{ value: 'openai/gpt-5', label: 'openai/gpt-5', description: 'GPT-5' },
			{
				value: 'openrouter/anthropic/claude-sonnet-4',
				label: 'openrouter/anthropic/claude-sonnet-4',
				description: 'Claude Sonnet 4',
			},
		];

		expect(filterModelItems(items, 'OPENAI').map((item) => item.value)).toEqual([
			'openai/gpt-5',
		]);
		expect(filterModelItems(items, 'sonnet').map((item) => item.value)).toEqual([
			'openrouter/anthropic/claude-sonnet-4',
		]);
		expect(filterModelItems(items, 'openrouter claude').map((item) => item.value)).toEqual([
			'openrouter/anthropic/claude-sonnet-4',
		]);
		expect(filterModelItems(items, 'missing')).toEqual([]);
		expect(filterModelItems(items, '')).toEqual(items);
	});

	it('registers the model selector command', () => {
		const { commandName, commandOptions } = captureHandler(tempConfigPath());

		expect(commandName).toBe('webfetch:model');
		expect(commandOptions.description).toContain('research model');
	});

	it('persists a model selected from the host available-model registry', async () => {
		const path = tempConfigPath();
		const { commandOptions } = captureHandler(path);
		const ctx = createContext('openrouter/anthropic/claude-sonnet-4');

		await commandOptions.handler('', ctx as never);

		expect(ctx.waitForIdle).toHaveBeenCalledOnce();
		expect(ctx.modelRegistry.getAvailable).toHaveBeenCalledOnce();
		expect(loadWebfetchConfig(path)).toEqual({
			researchModel: {
				provider: 'openrouter',
				id: 'anthropic/claude-sonnet-4',
			},
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'Research model set to openrouter/anthropic/claude-sonnet-4.',
			'info',
		);
	});

	it('clears the selection so research inherits Pi defaults', async () => {
		const path = tempConfigPath();
		saveWebfetchConfig({ researchModel: { provider: 'openai', id: 'gpt-5' } }, path);
		const { commandOptions } = captureHandler(path);
		const ctx = createContext(USE_PI_DEFAULT_MODEL);

		await commandOptions.handler('', ctx as never);

		expect(loadWebfetchConfig(path)).toEqual({});
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			'Research model reset to the Pi default.',
			'info',
		);
	});

	it('does not change configuration when the selector is cancelled', async () => {
		const path = tempConfigPath();
		saveWebfetchConfig({ researchModel: { provider: 'openai', id: 'gpt-5' } }, path);
		const { commandOptions } = captureHandler(path);
		const ctx = createContext(null as never);

		await commandOptions.handler('', ctx as never);

		expect(loadWebfetchConfig(path)).toEqual({
			researchModel: { provider: 'openai', id: 'gpt-5' },
		});
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});
});
