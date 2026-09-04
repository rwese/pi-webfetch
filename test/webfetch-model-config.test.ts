import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getWebfetchConfigPath,
	loadWebfetchConfig,
	saveWebfetchConfig,
	type ResearchModelConfig,
} from '../extensions/model-config.js';

const tempDirs: string[] = [];

function tempConfigPath(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-webfetch-model-'));
	tempDirs.push(dir);
	return join(dir, 'nested', 'pi-webfetch.json');
}

afterEach(async () => {
	const { rm } = await import('node:fs/promises');
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('webfetch model config', () => {
	it('stores configuration under the Pi agent directory', () => {
		expect(getWebfetchConfigPath('/tmp/pi-agent')).toBe('/tmp/pi-agent/pi-webfetch.json');
	});

	it('returns an empty config when the file does not exist', () => {
		expect(loadWebfetchConfig(tempConfigPath())).toEqual({});
	});

	it('round-trips a selected provider and model id', () => {
		const path = tempConfigPath();
		const researchModel: ResearchModelConfig = {
			provider: 'openrouter',
			id: 'anthropic/claude-sonnet-4',
		};

		saveWebfetchConfig({ researchModel }, path);

		expect(loadWebfetchConfig(path)).toEqual({ researchModel });
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ researchModel });
	});

	it('round-trips apiKey and baseUrl overrides', () => {
		const path = tempConfigPath();
		const researchModel: ResearchModelConfig = {
			provider: 'opencode-go',
			id: 'deepseek-v4-flash',
			apiKey: 'litellm-proxy-key',
			baseUrl: 'https://litellm.void.cold.at/v1',
		};

		saveWebfetchConfig({ researchModel }, path);

		expect(loadWebfetchConfig(path)).toEqual({ researchModel });
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ researchModel });
	});

	it('fails safely for malformed or invalid configuration', () => {
		const path = tempConfigPath();
		const dir = join(path, '..');
		mkdirSync(dir, { recursive: true });

		writeFileSync(path, '{invalid', 'utf8');
		expect(loadWebfetchConfig(path)).toEqual({});

		writeFileSync(path, JSON.stringify({ researchModel: { provider: '', id: 42 } }), 'utf8');
		expect(loadWebfetchConfig(path)).toEqual({});

		writeFileSync(
			path,
			JSON.stringify({ researchModel: { provider: 'openai', id: 'gpt-5', baseUrl: '' } }),
			'utf8',
		);
		expect(loadWebfetchConfig(path)).toEqual({});

		writeFileSync(
			path,
			JSON.stringify({ researchModel: { provider: 'openai', id: 'gpt-5', apiKey: 42 } }),
			'utf8',
		);
		expect(loadWebfetchConfig(path)).toEqual({});
	});

	it('persists clearing the selected model', () => {
		const path = tempConfigPath();
		saveWebfetchConfig({ researchModel: { provider: 'openai', id: 'gpt-5' } }, path);
		saveWebfetchConfig({}, path);

		expect(loadWebfetchConfig(path)).toEqual({});
	});
});
