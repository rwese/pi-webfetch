import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

export interface ResearchModelConfig {
	provider: string;
	id: string;
	/** Optional explicit API key for the provider. When unset, provider env
	 *  vars are used (e.g. `ANTHROPIC_API_KEY`). */
	apiKey?: string;
}

export interface WebfetchConfig {
	researchModel?: ResearchModelConfig;
}

export function getWebfetchConfigPath(agentDir: string = getAgentDir()): string {
	return join(agentDir, 'pi-webfetch.json');
}

function isResearchModelConfig(value: unknown): value is ResearchModelConfig {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate['provider'] !== 'string' ||
		candidate['provider'].trim().length === 0 ||
		typeof candidate['id'] !== 'string' ||
		candidate['id'].trim().length === 0
	) {
		return false;
	}
	const apiKey = candidate['apiKey'];
	if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.trim().length === 0)) {
		return false;
	}
	return true;
}

/** Load the persisted extension config. Missing or invalid files safely use defaults. */
export function loadWebfetchConfig(configPath: string = getWebfetchConfigPath()): WebfetchConfig {
	if (!existsSync(configPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const researchModel = (parsed as Record<string, unknown>)['researchModel'];
		if (researchModel === undefined) return {};
		if (!isResearchModelConfig(researchModel)) return {};
		const result: ResearchModelConfig = {
			provider: researchModel.provider.trim(),
			id: researchModel.id.trim(),
		};
		if (typeof researchModel.apiKey === 'string' && researchModel.apiKey.trim().length > 0) {
			result.apiKey = researchModel.apiKey.trim();
		}
		return { researchModel: result };
	} catch {
		return {};
	}
}

/** Persist configuration with an atomic same-directory rename. */
export function saveWebfetchConfig(
	config: WebfetchConfig,
	configPath: string = getWebfetchConfigPath(),
): void {
	const dir = dirname(configPath);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: 'utf8',
			mode: 0o600,
		});
		renameSync(tempPath, configPath);
	} catch (error) {
		rmSync(tempPath, { force: true });
		throw error;
	}
}
