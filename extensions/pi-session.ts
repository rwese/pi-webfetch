/**
 * In-process pi coding-agent session wrapper for research queries.
 *
 * Replaces the spawned `pi --mode rpc` subprocess (see
 * `docs/plans/PLAN_SDK_IN_PROCESS.md`). The research subagent is a direct
 * in-process `AgentSession` created via the `@earendil-works/pi-coding-agent`
 * SDK's `createAgentSession`, giving pi-webfetch full control over the
 * subagent's tools, model, and API keys — no pre-configured `pi` runtime
 * instance required.
 *
 * The SDK's auth/model surface changed in 0.84.4: `createAgentSession` now
 * takes a `modelRuntime` (a `ModelRuntime`) instead of the legacy
 * `authStorage` / `modelRegistry` pair. We build an isolated `ModelRuntime`
 * with a temp auth file and inject any explicit / env-driven API key as a
 * runtime key, so the user's `~/.pi/agent/auth.json` is never read.
 *
 * Event surface:
 * - `message_update` with `assistantMessageEvent.type === 'text_delta'` →
 *   streamed text (coalesced to a 16ms flush, byte-equal to the delta
 *   concatenation).
 * - `message_update` with `assistantMessageEvent.type === 'thinking_delta'` →
 *   `onThinking`.
 * - `tool_execution_start` → `onToolCall` with the parent-friendly phase
 *   mapping (`read` / `grep` / `find` / `ls` → `'reading'`, `bash` →
 *   `'executing'`, default → `'thinking'`).
 * - `agent_end` → the turn is done; `session.prompt()` resolves.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwd as processCwd } from 'node:process';
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { getModel, getEnvApiKey, type Model, type Api } from '@earendil-works/pi-ai/compat';
import { PiAgentError } from './pi-errors.js';
import type { ResearchModelConfig } from './model-config.js';

/** Phase mapping for tool events. */
export type ToolPhase = 'reading' | 'executing' | 'thinking';

/** Tool event payload for the `onToolCall` callback. */
export interface PiSessionToolEvent {
	phase: ToolPhase;
	name: string;
	args: unknown;
}

export interface PiSessionOptions {
	/** The prompt to send to the subagent. */
	prompt: string;
	/** Working directory for the subagent (default: `process.cwd()`). */
	cwd?: string;
	/** Wall-clock budget in ms. Default: 300000 (5 min). */
	timeoutMs?: number;
	/** Model + optional API key for the research subagent. */
	model?: ResearchModelConfig;
	/**
	 * Environment variables to layer over `process.env` when resolving the
	 * model's API key (best-effort). The SDK reads `process.env` directly;
	 * caller-supplied env vars are applied as runtime auth keys.
	 */
	env?: Record<string, string>;
	/** Callback for streamed text deltas (coalesced to ~16ms). */
	onChunk?: (chunk: string) => void;
	/** Callback for `tool_execution_start` events. */
	onToolCall?: (event: PiSessionToolEvent) => void;
	/** Callback for `thinking_delta` events. */
	onThinking?: (chunk: string) => void;
	/**
	 * Deterministic session id to seed the in-process session with, so the
	 * transcript is resumable via `pi --session <id>`.
	 */
	sessionId?: string;
	/** Human-readable session name (surfaced in `pi -r` pickers). */
	sessionName?: string;
}

export interface PiSessionResult {
	/** The final assistant text (from the last assistant message). */
	analysis: string;
	/** Live `sessionId` from the in-process `AgentSession`. */
	sessionId: string;
	/** Live `sessionName` from the in-process `AgentSession`. */
	sessionName?: string;
}

/** Default tools enabled for research (maps to the SDK's tool allowlist). */
export const DEFAULT_RESEARCH_TOOLS = ['read', 'grep', 'find', 'ls', 'bash'] as const;

/**
 * Map a tool name to a parent-visible phase. Same mapping as the removed
 * `PiRpcClient.toolNameToPhase`.
 */
export function toolNameToPhase(name: string): ToolPhase {
	switch (name) {
		case 'read':
		case 'grep':
		case 'find':
		case 'ls':
			return 'reading';
		case 'bash':
			return 'executing';
		default:
			return 'thinking';
	}
}

/**
 * Resolve the API key for a provider. Priority:
 * 1. explicit `ResearchModelConfig.apiKey`,
 * 2. caller-supplied `env` var for the provider (via `getEnvApiKey` naming),
 * 3. `process.env` var for the provider.
 *
 * Returns `undefined` when no key is available; the SDK's `ModelRuntime` also
 * falls back to env vars itself, so this is a best-effort pre-check.
 */
function resolveApiKey(
	model: ResearchModelConfig,
	env: Record<string, string> | undefined,
): string | undefined {
	if (model.apiKey) return model.apiKey;
	const envKey = getEnvApiKey(model.provider);
	if (envKey) return envKey;
	if (env) {
		// Layer caller-supplied env vars over process.env: for each var in the
		// caller env, re-check the provider env-key name.
		for (const [name, value] of Object.entries(env)) {
			if (name === `${model.provider.toUpperCase()}_API_KEY` && value) return value;
		}
	}
	return undefined;
}

/** Format for the `PI_WEBFETCH_MODEL` env var: `<provider>/<model-id>`. */
const MODEL_ENV_FORMAT = /^\s*([^/\s]+)\/([^\s]+)\s*$/;

/**
 * Build an isolated `ModelRuntime` for the research subagent.
 *
 * The runtime uses a temp auth file (so the user's `~/.pi/agent/auth.json` is
 * never read) and no custom `models.json` (built-in models only). Network
 * refresh is disabled; static built-in models remain available. An explicit /
 * env-driven API key is injected as a runtime key via `setRuntimeApiKey`.
 */
async function buildModelRuntime(
	modelConfig: ResearchModelConfig | undefined,
	apiKey: string | undefined,
): Promise<ModelRuntime> {
	const authPath = join(tmpdir(), 'pi-webfetch-auth.json');
	const modelRuntime = await ModelRuntime.create({
		authPath,
		modelsPath: null,
		refreshOnCreate: false,
	});
	if (modelConfig && apiKey) {
		await modelRuntime.setRuntimeApiKey(modelConfig.provider, apiKey);
	}
	return modelRuntime;
}

/**
 * Resolve the model instance for the research subagent from an explicit model
 * config, using the runtime's built-in model lookup, then `getModel` from
 * `@earendil-works/pi-ai/compat` (known providers).
 */
function resolveModel(
	modelRuntime: ModelRuntime,
	modelConfig: ResearchModelConfig,
): Model<Api> | undefined {
	const found = modelRuntime.getModel(modelConfig.provider, modelConfig.id);
	if (found) return found;
	try {
		return getModel(modelConfig.provider as never, modelConfig.id as never) as Model<Api>;
	} catch {
		return undefined;
	}
}

/**
 * Resolve a default model from the environment (`PI_WEBFETCH_MODEL=provider/id`).
 * Returns `undefined` when no env model can be resolved.
 */
function resolveModelFromEnv(modelRuntime: ModelRuntime): Model<Api> | undefined {
	const raw = process.env['PI_WEBFETCH_MODEL'];
	if (!raw) return undefined;
	const match = MODEL_ENV_FORMAT.exec(raw);
	if (!match) return undefined;
	const provider = match[1] as string;
	const id = match[2] as string;
	const found = modelRuntime.getModel(provider, id);
	if (found) return found;
	try {
		return getModel(provider as never, id as never) as Model<Api>;
	} catch {
		return undefined;
	}
}

/**
 * Run the research subagent in-process.
 *
 * @throws {PiAgentError} If the model cannot be resolved, the turn fails,
 *   or the run times out.
 */
export async function runPiSession(options: PiSessionOptions): Promise<PiSessionResult> {
	const {
		prompt,
		cwd: cwdOption = processCwd(),
		timeoutMs = 300_000,
		model: modelOption,
		env: envOption,
		onChunk,
		onToolCall,
		onThinking,
		sessionId,
		sessionName,
	} = options;

	// Explicit pi-webfetch-managed auth: an isolated ModelRuntime (temp auth
	// file). Never reads the user's `~/.pi/agent/auth.json`.
	const apiKey = modelOption ? resolveApiKey(modelOption, envOption) : undefined;
	const modelRuntime = await buildModelRuntime(modelOption, apiKey);

	let model: Model<Api> | undefined;
	if (modelOption) {
		model = resolveModel(modelRuntime, modelOption);
		if (!model) {
			throw new PiAgentError(
				`No model found for provider "${modelOption.provider}" id "${modelOption.id}". ` +
					`Set a research model with /webfetch:model, PI_WEBFETCH_MODEL=provider/id, or pass --model.`,
				null,
			);
		}
		// Apply the user's base URL override (custom gateway / proxy, e.g. a
		// LiteLLM endpoint) on top of the resolved model. The resolved model
		// bakes in the provider's default endpoint; cloning with the override
		// makes the request builder (e.g. `openai-completions` reads
		// `model.baseUrl`) hit the custom host.
		if (modelOption.baseUrl) {
			model = { ...model, baseUrl: modelOption.baseUrl };
		}
	} else {
		// No explicit model: fall back to `PI_WEBFETCH_MODEL=provider/id`.
		model = resolveModelFromEnv(modelRuntime);
		if (!model) {
			throw new PiAgentError(
				'No research model available. Set PI_WEBFETCH_MODEL=provider/id, ' +
					'a research model with /webfetch:model, or an API key env var for a known provider.',
				null,
			);
		}
	}

	// Seed the session manager with the deterministic id so the transcript is
	// resumable via `pi --session <id>`.
	const sessionManager = SessionManager.create(cwdOption);
	if (sessionId) {
		sessionManager.newSession({ id: sessionId });
	}

	const { session } = await createAgentSession({
		cwd: cwdOption,
		modelRuntime,
		model,
		// Research subagent tool allowlist — read/grep/find/ls/bash only. No
		// edit/write: the subagent must not mutate the repo.
		tools: [...DEFAULT_RESEARCH_TOOLS],
		sessionManager,
		settingsManager: SettingsManager.inMemory(),
	});

	// Live session identity (the in-process session adopts the seeded id, but
	// the live values are the source of truth).
	const liveSessionId = session.sessionId || sessionId || '';
	const liveSessionName = session.sessionName ?? sessionName;
	if (sessionName) {
		session.setSessionName(sessionName);
	}

	// Coalesce text deltas in a small buffer, flushed on a 16ms cadence.
	let textBuffer = '';
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	const flushBuffer = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (textBuffer.length > 0) {
			const chunk = textBuffer;
			textBuffer = '';
			onChunk?.(chunk);
		}
	};
	const scheduleFlush = () => {
		if (flushTimer) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			flushBuffer();
		}, 16);
	};

	const unsubscribe = session.subscribe((event) => {
		if (event.type === 'message_update') {
			const inner = event.assistantMessageEvent as
				{ type: string; delta?: string } | undefined;
			if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
				textBuffer += inner.delta;
				scheduleFlush();
			} else if (inner?.type === 'thinking_delta' && typeof inner.delta === 'string') {
				onThinking?.(inner.delta);
			}
		} else if (event.type === 'tool_execution_start') {
			flushBuffer();
			onToolCall?.({
				phase: toolNameToPhase(event.toolName),
				name: event.toolName,
				args: event.args,
			});
		}
	});

	let timedOut = false;
	let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutTimer = setTimeout(() => {
			timedOut = true;
			timeoutTimer = null;
			// Kick off the abort; the catch path awaits it before disposing.
			void session.abort();
			reject(new PiAgentError(`Pi agent timed out after ${timeoutMs}ms`, null));
		}, timeoutMs);
	});

	let promptError: unknown;
	try {
		await Promise.race([session.prompt(prompt), timeout]);
	} catch (err) {
		promptError = err;
	} finally {
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = null;
		}
		if (flushTimer) clearTimeout(flushTimer);
		unsubscribe();
	}

	// On timeout, wait for the abort to settle before tearing down the
	// session so the in-flight turn cannot touch disposed state.
	if (timedOut) {
		try {
			await session.abort();
		} catch {
			// Best-effort: the session may already be idle.
		}
	}

	// Extract the final assistant text from the last assistant message. This
	// is byte-equal to the concatenation of all text_delta events.
	const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant');
	const finalText =
		lastAssistant && 'content' in lastAssistant
			? (lastAssistant.content as Array<{ type: string; text?: string }>)
					.filter((c) => c.type === 'text' && typeof c.text === 'string')
					.map((c) => c.text as string)
					.join('')
			: textBuffer;

	session.dispose();

	if (promptError !== undefined) {
		throw promptError instanceof Error ? promptError : new Error(String(promptError));
	}

	return {
		analysis: finalText.trim(),
		sessionId: liveSessionId,
		sessionName: liveSessionName,
	};
}
