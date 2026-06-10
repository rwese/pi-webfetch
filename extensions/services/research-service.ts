/**
 * Research Service
 *
 * Handles research queries that spawn pi sub-agents for content analysis.
 */

import type { WebfetchDetails, FetchResult } from '../types.js';
import type { AgentToolUpdateCallback } from '@mariozechner/pi-coding-agent';
import { spawnPiAgent, type SpawnPiAgentResult } from '../pi-agent.js';
import type { PiRpcToolEvent } from '../pi-rpc-client.js';
import type { FetchPhase } from '../fetch-phases.js';
import { fetchUrl, type ProviderFetchOptions } from './fetch-service.js';
import {
	formatResumeHint,
	deriveSessionId,
	deriveSessionName,
	type ResumeSource,
} from '../utils/resume.js';
import { writeInputFiles, type ResearchInputFiles } from '../utils/formatting.js';

/** Result type for research queries */
export interface ResearchResult {
	/** The analysis text from the sub-agent */
	analysis: string;
	/** The original fetch result details */
	details: WebfetchDetails;
}

/** Status callback for long-running operations */
export type StatusCallback = (status: string, phase?: FetchPhase) => void;

/** OnUpdate callback type alias for clarity */
type OnUpdateCallback = AgentToolUpdateCallback<Record<string, unknown>>;

/** Notification channel for the agent-error path. The surface decides
 *  what to do with the message (TUI notify, stderr line, etc.). */
export type ResearchNotify = (message: string, level: 'info' | 'warn' | 'error') => void;

/** Streaming callback configuration for webfetch */
export interface StreamingConfig {
	/** The main onUpdate callback from the tool */
	callback: OnUpdateCallback | undefined;
	/** The URL being fetched */
	url: string;
	/** Phase to show during initial processing */
	initialPhase: FetchPhase;
	/** Phase to show during streaming */
	streamingPhase: FetchPhase;
	/** Whether to show header */
	showHeader?: boolean;
}

/**
 * Send a partial update through the streaming callback
 */
function sendStreamingUpdate(config: StreamingConfig, content: string, phase: FetchPhase): void {
	config.callback?.({
		content: [{ type: 'text', text: content }],
		details: { phase, url: config.url },
	});
}

/**
 * Yield to event loop to allow UI updates to be processed
 */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Format a subagent tool event as a short human-readable content
 * line. Used by the streaming path to render live progress; the
 * non-streaming path drops the line (the result body is the
 * subagent's final text, not the intermediate tool calls).
 *
 * Examples:
 *   `📖 reading /tmp/.../input.md`
 *   `🔧 bash: ls /tmp/...`
 *   `💭 thinking: webfetch`
 */
function formatToolEvent(event: PiRpcToolEvent, inputFiles: ResearchInputFiles): string {
	const args = (event.args ?? {}) as Record<string, unknown>;
	switch (event.phase) {
		case 'reading': {
			const path =
				typeof args['path'] === 'string'
					? (args['path'] as string)
					: event.name === 'read' && inputFiles.inputFile
						? inputFiles.inputFile
						: '';
			const suffix = path ? ` ${path}` : '';
			return `📖 ${event.name}${suffix}`;
		}
		case 'executing': {
			const command = typeof args['command'] === 'string' ? (args['command'] as string) : '';
			const suffix = command ? `: ${command}` : '';
			return `🔧 ${event.name}${suffix}`;
		}
		case 'thinking':
		default: {
			const argsText = Object.keys(args).length > 0 ? `: ${event.name}` : '';
			return `💭 ${event.name}${argsText}`;
		}
	}
}

/**
 * Fetch a URL and analyze its content based on a research query
 *
 * @param url - The URL to fetch
 * @param query - Optional research question/analysis request
 * @param fetchFn - Optional fetch function (defaults to global fetch)
 * @param onStatus - Optional status callback for non-streaming updates
 * @param streamingConfig - Optional streaming configuration for real-time updates
 * @param provider - Optional provider override
 * @param options - Provider fetch options (e.g. GitHub-specific options)
 * @param now - Optional clock injection. The clock determines the
 *                       deterministic subagent session id (derived from
 *                       `now()`, url, query); the catch block reuses
 *                       the same id so the resume command points at
 *                       the actual spawned subagent.
 * @param notify - Optional callback fired once on the agent-error path
 * @param resumeSource - Which surface produced the error. Controls the
 *                       `resumeCommand` (extension → `pi --session <id>`,
 *                       CLI / MCP → `pi-webfetch webfetch <url> --query <q>`).
 * @param timeout - Optional per-call override (ms) for the spawned
 *                       research subagent. Falls back to the spawn
 *                       default (`DEFAULT_PI_AGENT_TIMEOUT_MS` in
 *                       `extensions/pi-agent.ts`, currently 180000).
 * @returns FetchResult with analysis or error content
 *
 * @example
 * ```typescript
 * // With query - returns AI analysis
 * const result = await webfetchResearch('https://example.com', 'Summarize this page');
 *
 * // Without query - falls back to regular fetch
 * const result = await webfetchResearch('https://example.com');
 * ```
 */
export async function webfetchResearch(
	url: string,
	query?: string,
	fetchFn?: typeof fetch,
	onStatus?: StatusCallback,
	streamingConfig?: StreamingConfig | OnUpdateCallback,
	provider?: string,
	options?: ProviderFetchOptions,
	now: () => number = () => Date.now(),
	notify?: ResearchNotify,
	resumeSource: ResumeSource = 'extension',
	timeout?: number,
): Promise<FetchResult> {
	// Use provided fetch or default
	const fetchFunc = fetchFn || fetch;

	// Normalize streaming config - handle both StreamingConfig and legacy OnUpdateCallback
	let config: StreamingConfig | undefined;
	if (streamingConfig) {
		if ('callback' in streamingConfig) {
			config = streamingConfig;
		} else {
			// Legacy OnUpdateCallback - wrap it
			config = {
				callback: streamingConfig,
				url,
				initialPhase: 'processing',
				streamingPhase: 'streaming',
			};
		}
	}

	// Phase 1: Detect provider
	if (config) {
		sendStreamingUpdate(config, '🔍 Detecting provider...', 'detecting-provider');
	} else {
		onStatus?.('Detecting provider...', 'detecting-provider');
	}
	await yieldToEventLoop();

	// Phase 2: Fetch URL content
	if (config) {
		sendStreamingUpdate(config, '🌐 Fetching...', 'fetching');
	} else {
		onStatus?.('Fetching...', 'fetching');
	}
	const fetchResult = await fetchUrl(url, fetchFunc, provider, options);

	// If no query provided, return regular fetch result
	if (!query) {
		// Show processing phase
		if (config) {
			sendStreamingUpdate(config, '⚙️ Processing content...', 'processing');
		} else {
			onStatus?.('Processing...', 'processing');
		}
		await yieldToEventLoop();
		return fetchResult;
	}

	// Extract content from fetch result
	const content = fetchResult.content[0]?.text || '';

	// Check if we have actual content to analyze
	if (!content || content.includes('Error:')) {
		return fetchResult;
	}

	// Promote the subagent to a real, named, persistent pi session so
	// the user can `pi --session <id>` into the failed transcript.
	// Derive these OUTSIDE the try block so the catch block can reuse
	// the exact same ids - re-deriving with a fresh `now()` call would
	// produce a different id and the user would be pointed at a
	// non-existent session.
	const sessionId = deriveSessionId(now(), url, query);
	const sessionName = deriveSessionName(url);

	// Write the research subagent's input files (processed markdown
	// + optional raw) to a session-keyed work dir BEFORE spawning
	// the subagent. The lean prompt references the file paths; the
	// subagent `read`s / `grep`s the content on demand. Doing the
	// write outside the try block means a write failure surfaces as
	// a hard error (no spawn, no half-written session). The same
	// paths are also surfaced in the success / error result details
	// so the user can `ls` the work dir if they want to inspect it.
	const inputFiles: ResearchInputFiles = await writeInputFiles(sessionId, {
		content,
		rawContent: fetchResult.details.rawContent,
		rawContentType: fetchResult.details.rawContentType,
	});

	try {
		// Phase 3: Analyze content
		if (config) {
			sendStreamingUpdate(config, '🧠 Analyzing content...', 'analyzing');
		} else {
			onStatus?.('Analyzing...', 'analyzing');
		}
		await yieldToEventLoop();

		// Build header
		const header = [
			`## Research Result\n`,
			`**Command:** /webfetch ${url} "${query}"\n`,
			`\n---\n`,
		].join('');

		// If we have streaming config, stream results directly to it
		if (config) {
			// Send initial header as first update
			sendStreamingUpdate(config, header + '📝 Generating response...', config.initialPhase);
			await yieldToEventLoop();

			// Stream chunks from pi agent directly to onUpdate.
			// Tool events from the JSON-RPC subagent are mapped to
			// the parent-friendly `phase` union (`'reading'` /
			// `'executing'` / `'thinking'`) with a short
			// human-readable content line.
			const agentResult: SpawnPiAgentResult = await spawnPiAgent(content, query, {
				onChunk: (chunk) => {
					config.callback?.({
						content: [{ type: 'text', text: chunk }],
						details: { phase: config.streamingPhase, url, streamed: true },
					});
				},
				onToolCall: (event: PiRpcToolEvent) => {
					const toolContent = formatToolEvent(event, inputFiles);
					config.callback?.({
						content: [{ type: 'text', text: toolContent }],
						details: { phase: event.phase, url, streamed: true },
					});
				},
				sessionId,
				sessionName,
				url,
				inputFile: inputFiles.inputFile,
				inputRawFile: inputFiles.inputRawFile,
				...(timeout !== undefined ? { timeout } : {}),
			});

			const researchDetails: WebfetchDetails = {
				...fetchResult.details,
				processedAs: 'research',
				phase: 'complete',
				subagentSessionId: agentResult.sessionId ?? sessionId,
				subagentSessionName: agentResult.sessionName ?? sessionName,
				workDir: inputFiles.workDir,
				inputFile: inputFiles.inputFile,
				inputRawFile: inputFiles.inputRawFile,
			};

			// Return with final analysis (chunks already streamed)
			return {
				content: [{ type: 'text', text: header + agentResult.analysis }],
				details: researchDetails,
			};
		}

		// No streaming available, use regular behavior
		const agentResult: SpawnPiAgentResult = await spawnPiAgent(content, query, {
			onToolCall: (event: PiRpcToolEvent) => {
				// No streaming config: just log a debug-level hint
				// so the tool call is observable. The CLI / MCP /
				// tool surface can layer its own reporting on top.
				// (We deliberately do not surface the tool call in
				// the result body — the parent rendered the streaming
				// path above; the non-streaming path is a fallback.)
				void formatToolEvent(event, inputFiles);
			},
			sessionId,
			sessionName,
			url,
			inputFile: inputFiles.inputFile,
			inputRawFile: inputFiles.inputRawFile,
			...(timeout !== undefined ? { timeout } : {}),
		});

		const researchDetails: WebfetchDetails = {
			...fetchResult.details,
			processedAs: 'research',
			subagentSessionId: agentResult.sessionId ?? sessionId,
			subagentSessionName: agentResult.sessionName ?? sessionName,
			workDir: inputFiles.workDir,
			inputFile: inputFiles.inputFile,
			inputRawFile: inputFiles.inputRawFile,
		};

		return {
			content: [{ type: 'text', text: header + agentResult.analysis }],
			details: researchDetails,
		};
	} catch (error) {
		// On agent error, fall back to showing the fetched content. The
		// markdown body is byte-identical to the pre-change baseline on
		// purpose: the resume hint lives in `details` and in the
		// `notify` side-channel so the agent's context is not polluted.
		const errorMessage = error instanceof Error ? error.message : String(error);
		const fallbackHeader = [
			`## Fetch Result (Agent Error)\n`,
			`**Command:** /webfetch ${url} "${query}"\n`,
			`**Agent Error:** ${errorMessage}\n`,
			`\n---\n`,
		].join('');

		// Reuse the SAME sessionId / sessionName the spawn call was
		// invoked with, so the user can actually `pi --session <id>`
		// the failed transcript. Re-deriving here with a fresh
		// `now()` would silently break the resume feature.
		const hint = formatResumeHint({
			sessionId,
			sessionName,
			source: resumeSource,
			url,
			query,
			errorMessage,
		});
		notify?.(hint.message, 'error');

		return {
			content: [{ type: 'text', text: fallbackHeader + content }],
			details: {
				...fetchResult.details,
				processedAs: 'error',
				phase: 'error',
				subagentSessionId: hint.details.subagentSessionId,
				subagentSessionName: hint.details.subagentSessionName,
				resumeCommand: hint.details.resumeCommand,
				notify: hint.message,
				// Surface the work dir + input paths on the error path
				// too. The user can `ls <workDir>` to see the markdown
				// and raw files that were prepared for the (failed)
				// subagent, even when the subagent itself did not
				// produce a useful result. This is useful when the
				// agent errored before reading the input (e.g.
				// timeout at startup).
				workDir: inputFiles.workDir,
				inputFile: inputFiles.inputFile,
				inputRawFile: inputFiles.inputRawFile,
			},
		};
	}
}
