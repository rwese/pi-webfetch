/**
 * Pi JSON-RPC client
 *
 * A thin JSON-RPC transport wrapper for the `pi` coding agent's `--mode rpc`
 * mode. Spawns `pi` directly (no `node` cold-start), drives a strict-JSONL
 * frame on stdout, correlates command responses on stdin, and surfaces a
 * small event-driven API:
 *
 * - `onText(delta)` — coalesced `message_update` `text_delta` events.
 * - `onTool({ phase, name, args })` — `tool_execution_start` events, with
 *   a phase mapping (`read`/`grep`/`find`/`ls` → `'reading'`,
 *   `bash` → `'executing'`, default → `'thinking'`).
 * - `onThinking(delta)` — `message_update` `thinking_delta` events.
 * - `run({ prompt, timeoutMs? })` — sends the prompt, waits for `agent_end`,
 *   fetches the final text via `get_last_assistant_text`, resolves with
 *   `{ text, sessionId, sessionName, exitCode }`. Rejects with
 *   `PiAgentError` on timeout or non-zero exit.
 *
 * The wrapper is **not** a subclass of `RpcClient` (see
 * `docs/plans/PLAN_PI_JSONRPC.md` for the trade-off). The two protocol-aware
 * helpers (`attachJsonlLineReader` / `serializeJsonLine`) are re-implemented
 * inline below; the upstream module is `@mariozechner/pi-coding-agent`'s
 * `dist/modes/rpc/jsonl.js`, which the package's `exports` field does not
 * expose. The LF-only split is the key correctness property (Node `readline`
 * splits on U+2028 / U+2029, which are valid inside JSON strings).
 */

import type { Readable, Writable } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { PiAgentError } from './pi-agent.js';

/** Type alias for `node:child_process.spawn` to keep top-of-file
 *  type imports consistent. The real `spawn` is a union of
 *  overloads; we type the wrapper's `spawn` option as a permissive
 *  signature that accepts any of the real overloads. */
export type NodeSpawn = ((
	command: string,
	args?: readonly string[] | undefined,
	options?: SpawnOptions,
) => ChildProcess) & {
	(command: string, options?: SpawnOptions): ChildProcess;
};

/**
 * Lazy default `spawn` factory. We resolve the real
 * `node:child_process.spawn` at call time (not at module-load time)
 * so that test-time `vi.mock('node:child_process', ...)` correctly
 * applies to the wrapper's default spawn. Capturing the binding at
 * import time would freeze the import before the mock is applied.
 */
const require = createRequire(import.meta.url);
const childProcessModule = require('node:child_process') as { spawn: NodeSpawn };
/**
 * The default `spawn` factory reads the current `spawn` from
 * `node:child_process` at call time. This is what allows test
 * harnesses (vitest's `vi.mock('node:child_process', ...)`) to
 * replace `spawn` after this module has loaded.
 *
 * The cast through `unknown` is required because the real
 * `spawn` exposes a union of overloads that a single function
 * signature cannot satisfy.
 */
const defaultSpawn = ((...args: unknown[]) =>
	(childProcessModule.spawn as (...a: unknown[]) => ChildProcess)(
		...args,
	)) as unknown as NodeSpawn;

/** Phase mapping for tool events. */
export type ToolPhase = 'reading' | 'executing' | 'thinking';

/** Tool event payload for the `onTool` callback. */
export interface PiRpcToolEvent {
	phase: ToolPhase;
	name: string;
	args: unknown;
}

export interface PiRpcClientOptions {
	/** Path to the `pi` binary (default: `'pi'`, resolved via PATH). */
	piPath?: string;
	/** Working directory for the spawned `pi` process. */
	cwd?: string;
	/** Environment variables (merged with the parent env). */
	env?: Record<string, string>;
	/** Additional CLI args (after `--mode rpc`). e.g. `--name`, `--session-id`. */
	args?: string[];
	/**
	 * Auto-dismiss `extension_ui_request` events from the subagent
	 * (default: `true`). When `false`, the parent handles the events
	 * itself (this wrapper writes nothing to stdin on their behalf).
	 */
	autoDismissUiRequests?: boolean;
	/**
	 * Override the spawn function. Used by tests to inject a fake
	 * child process that mimics `pi --mode rpc` over stdin / stdout.
	 */
	spawn?: NodeSpawn;
}

export interface PiRpcRunOptions {
	/** The prompt to send. */
	prompt: string;
	/** Wall-clock budget in ms. Default: 300000 (5 min). */
	timeoutMs?: number;
}

export interface PiRpcRunResult {
	/** The final assistant text from `get_last_assistant_text`. */
	text: string;
	/** Live `sessionId` from `get_state` (not the pre-computed id). */
	sessionId: string;
	/** Live `sessionName` from `get_state`. */
	sessionName?: string;
	/** Exit code of the spawned `pi` process. */
	exitCode: number;
}

/** Pending command: the resolver for the JSON-RPC response. */
interface PendingCommand {
	id: string;
	resolve: (response: unknown) => void;
	reject: (err: Error) => void;
	command: string;
}

/** Callback for `agent_end` (used internally by `run()`). */
type AgentEndListener = (event: Record<string, unknown>) => void;

/**
 * Thin JSON-RPC client for `pi --mode rpc`.
 *
 * One pending command at a time (the research subagent is single-turn; we
 * do not interleave commands). Event listeners (`onText`, `onTool`,
 * `onThinking`) are registered before `run()` is called and are reset
 * between runs.
 */
export class PiRpcClient {
	private readonly options: Required<Omit<PiRpcClientOptions, 'spawn' | 'env'>> & {
		env: Record<string, string>;
		spawn: NodeSpawn;
	};
	private proc: ChildProcess | null = null;
	private pending: PendingCommand | null = null;
	private requestId = 0;
	private textListeners: Array<(chunk: string) => void> = [];
	private toolListeners: Array<(event: PiRpcToolEvent) => void> = [];
	private thinkingListeners: Array<(chunk: string) => void> = [];
	private agentEndListeners: AgentEndListener[] = [];
	private stderrBuf = '';
	private lastExitCode: number | null = null;

	constructor(options: PiRpcClientOptions = {}) {
		this.options = {
			piPath: options.piPath ?? 'pi',
			cwd: options.cwd ?? process.cwd(),
			env: options.env ?? {},
			args: options.args ?? [],
			autoDismissUiRequests: options.autoDismissUiRequests ?? true,
			spawn: options.spawn ?? defaultSpawn,
		};
	}

	/**
	 * Register a text-delta listener. Fires for coalesced chunks of
	 * `message_update` `text_delta` events from the subagent. The
	 * wrapper coalesces deltas in a small buffer and flushes on a
	 * 16ms cadence (one frame at 60fps) so a fast model that streams
	 * hundreds of deltas per second does not thrash the parent's
	 * renderer. A `tool_execution_start` event between deltas
	 * flushes the buffer immediately; `agent_end` flushes the final
	 * text. The total text the listener receives is byte-equal to
	 * the concatenation of all deltas.
	 */
	onText(listener: (chunk: string) => void): void {
		this.textListeners.push(listener);
	}

	/** Register a tool-event listener. Fires on `tool_execution_start`. */
	onTool(listener: (event: PiRpcToolEvent) => void): void {
		this.toolListeners.push(listener);
	}

	/** Register a thinking-delta listener. Fires per `thinking_delta`. */
	onThinking(listener: (chunk: string) => void): void {
		this.thinkingListeners.push(listener);
	}

	/**
	 * Spawn the `pi --mode rpc` subprocess. Idempotent: subsequent calls
	 * are no-ops (the wrapper is single-shot per `run()`).
	 */
	async start(): Promise<void> {
		if (this.proc) return;

		const args = ['--mode', 'rpc', ...this.options.args];
		this.proc = this.options.spawn(this.options.piPath, args, {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.proc.stderr?.on('data', (data: Buffer) => {
			this.stderrBuf += data.toString();
		});

		// Capture the exit code so `run()` can surface it on failure.
		// If the process exits with a non-zero code (or any code
		// before `agent_end`), reject the in-flight run so the
		// caller never hangs.
		this.proc.on('exit', (code) => {
			this.lastExitCode = code;
			// If a command is still pending, reject it with a
			// process-exited error so the caller never hangs.
			if (this.pending) {
				const { reject, command } = this.pending;
				this.pending = null;
				reject(
					new PiAgentError(
						`pi exited (code ${code}) before responding to ${command}: ${this.stderrBuf.trim() || '<no stderr>'}`,
						code,
						this.stderrBuf,
					),
				);
			}
			// Also reject the in-flight run() (if any) when the
			// process exits without emitting `agent_end`.
			if (code !== 0 && this.runRejectExit) {
				const reject = this.runRejectExit;
				this.runRejectExit = null;
				reject(
					new PiAgentError(
						`pi exited with code ${code}: ${this.stderrBuf.trim() || '<no stderr>'}`,
						code,
						this.stderrBuf,
					),
				);
			}
		});

		// Attach the LF-only JSONL reader on stdout.
		attachJsonlLineReader(this.proc.stdout as Readable, (line) => {
			this.handleLine(line);
		});
	}

	/**
	 * Send the prompt and resolve with the run result when the subagent
	 * emits `agent_end`. Rejects on timeout, non-zero exit, or spawn error.
	 */
	async run(opts: PiRpcRunOptions): Promise<PiRpcRunResult> {
		const { prompt, timeoutMs = 180_000 } = opts;
		await this.start();

		// Coalesce text deltas in a small buffer and flush on a 16ms
		// cadence. Tool events flush the buffer immediately; `agent_end`
		// flushes the final text.
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
				for (const fn of this.textListeners) fn(chunk);
			}
		};
		const scheduleFlush = () => {
			if (flushTimer) return;
			flushTimer = setTimeout(() => {
				flushTimer = null;
				flushBuffer();
			}, 16);
		};

		// We intercept text deltas to buffer them; once buffered, we
		// re-dispatch the flushed chunk to the user-registered
		// textListeners. To avoid double-dispatch, we do NOT call
		// textListeners from the JSONL path while buffering is active.
		// Instead, the JSONL path pushes to the buffer; the buffer
		// flush calls the listeners.
		const onTextDelta = (delta: string) => {
			textBuffer += delta;
			scheduleFlush();
		};
		const onToolStart = (event: PiRpcToolEvent) => {
			// Flush the buffer so the user sees the text leading up
			// to the tool call before the tool call itself.
			flushBuffer();
			for (const fn of this.toolListeners) fn(event);
		};
		const onThinkingDelta = (delta: string) => {
			for (const fn of this.thinkingListeners) fn(delta);
		};

		const agentEndPromise = new Promise<PiRpcRunResult>((resolve, reject) => {
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				this.runRejectExit = null;
				void this.stop();
				reject(new PiAgentError(`Pi agent timed out after ${timeoutMs}ms`, null));
			}, timeoutMs);

			// Stash a reject hook for the exit handler so a
			// non-zero exit (no `agent_end`) rejects the run.
			this.runRejectExit = (err) => {
				if (timedOut) return;
				clearTimeout(timer);
				this.runRejectExit = null;
				reject(err);
			};

			const onAgentEnd: AgentEndListener = () => {
				if (timedOut) return;
				clearTimeout(timer);
				// Detach this one-shot listener.
				const idx = this.agentEndListeners.indexOf(onAgentEnd);
				if (idx >= 0) this.agentEndListeners.splice(idx, 1);
				this.runRejectExit = null;
				// Flush the final text.
				flushBuffer();
				// Fetch the live session id (await each command
				// sequentially — the wrapper has one pending slot).
				void (async () => {
					try {
						const state = await this.getState();
						const text = await this.getLastAssistantText();
						resolve({
							text: text ?? '',
							sessionId: state.sessionId,
							sessionName: state.sessionName,
							exitCode: this.lastExitCode ?? 0,
						});
					} catch (err) {
						reject(err instanceof Error ? err : new Error(String(err)));
					}
				})();
			};
			this.agentEndListeners.push(onAgentEnd);
		});

		// Send the prompt. We do NOT await the response — the
		// wrapper has one pending slot, and `get_state` /
		// `get_last_assistant_text` called from the `agent_end`
		// listener will overwrite the pending. The response to
		// the prompt command is fire-and-forget for our purposes
		// (we just need the subagent to receive the prompt); the
		// `agent_end` event is the source of truth for completion.
		this.activeTextDeltaHandler = onTextDelta;
		this.activeToolStartHandler = onToolStart;
		this.activeThinkingDeltaHandler = onThinkingDelta;
		try {
			// Fire the prompt without awaiting. The pending slot
			// is consumed by the response (or dropped if a
			// later command overwrites it). Either way, we do
			// not hang on it.
			this.sendCommand({ type: 'prompt', message: prompt }).catch(() => {
				// The prompt command's failure is surfaced via
				// the `runRejectExit` exit-handler path; ignore
				// it here to avoid an unhandled rejection.
			});
		} catch {
			this.activeTextDeltaHandler = null;
			this.activeToolStartHandler = null;
			this.activeThinkingDeltaHandler = null;
			throw new Error('Failed to send prompt to subagent');
		}

		// Clean up active handlers when the run settles (success
		// or failure). The agent_end path clears them too; this
		// covers the timeout / exit paths.
		//
		// BUG-2026-06-17-JGCMZSET-CRONO: the `.finally()` mirror
		// promise must be catch'd here, otherwise a rejected run
		// (timeout / non-zero exit) propagates through the
		// finally chain as a fresh unhandledRejection. The
		// mirror runs *after* the awaited `run()` has settled,
		// so the awaiting try/catch cannot catch it; the
		// orphan promise leaks to Node's unhandledRejection
		// handler and crashes the host (pi) agent. The
		// cleanup itself is best-effort and the rejection
		// has already been observed by the awaiter, so we
		// swallow it here. See `test/pi-rpc-client.test.ts`
		// > "does not surface a second unhandled rejection
		// when run() times out".
		agentEndPromise.finally(() => {
			this.activeTextDeltaHandler = null;
			this.activeToolStartHandler = null;
			this.activeThinkingDeltaHandler = null;
		}).catch(() => {
			// Intentional no-op: the original rejection has
			// already been delivered to the awaited run(); the
			// finally-mirror must not re-surface it.
		});

		return agentEndPromise;
	}

	/**
	 * Active text-delta / tool-start / thinking-delta handlers for
	 * the in-flight `run()`. The JSONL dispatch path routes to
	 * these (instead of the user-registered listeners) so the
	 * wrapper can buffer text deltas and flush on a 16ms cadence.
	 * The user-registered listeners are only called from the
	 * buffer flush (text) or directly (tool / thinking).
	 */
	private activeTextDeltaHandler: ((delta: string) => void) | null = null;
	private activeToolStartHandler: ((event: PiRpcToolEvent) => void) | null = null;
	private activeThinkingDeltaHandler: ((delta: string) => void) | null = null;
	/**
	 * Reject hook for the in-flight `run()` so the exit handler
	 * can reject the run if the process exits non-zero before
	 * `agent_end` is seen. Cleared when the run resolves normally.
	 */
	private runRejectExit: ((err: Error) => void) | null = null;

	/** Handle a single JSONL line from the subagent's stdout. */
	private handleLine(line: string): void {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(line) as Record<string, unknown>;
		} catch {
			// Non-JSON lines are ignored.
			return;
		}

		// Response to a pending command.
		if (data.type === 'response' && typeof data.id === 'string' && this.pending) {
			// Match the response id against the pending command id.
			// The wrapper has one pending slot, so a mismatched
			// id means the response is for a command that timed
			// out or was already replaced — drop it.
			if (data.id !== this.pending.id) {
				return;
			}
			const pending = this.pending;
			this.pending = null;
			if (data.success === false) {
				pending.reject(
					new Error(
						typeof data.error === 'string'
							? data.error
							: `RPC command ${pending.command} failed`,
					),
				);
			} else {
				pending.resolve(data);
			}
			return;
		}

		// Extension UI request: auto-dismiss or ignore.
		if (data.type === 'extension_ui_request' && typeof data.id === 'string') {
			if (this.options.autoDismissUiRequests) {
				this.respondToUiRequest(data.id, data.method);
			}
			return;
		}

		// Text delta from the assistant message stream.
		if (data.type === 'message_update') {
			const inner = data.assistantMessageEvent as Record<string, unknown> | undefined;
			if (inner?.type === 'text_delta' && typeof inner.delta === 'string') {
				if (this.activeTextDeltaHandler) this.activeTextDeltaHandler(inner.delta);
				else for (const fn of this.textListeners) fn(inner.delta);
			} else if (inner?.type === 'thinking_delta' && typeof inner.delta === 'string') {
				if (this.activeThinkingDeltaHandler) this.activeThinkingDeltaHandler(inner.delta);
				else for (const fn of this.thinkingListeners) fn(inner.delta);
			}
			return;
		}

		// Tool call started.
		if (data.type === 'tool_execution_start') {
			const name = typeof data.toolName === 'string' ? data.toolName : '';
			const event: PiRpcToolEvent = {
				phase: toolNameToPhase(name),
				name,
				args: data.args,
			};
			if (this.activeToolStartHandler) this.activeToolStartHandler(event);
			else for (const fn of this.toolListeners) fn(event);
			return;
		}

		// agent_end: forward to all agent-end listeners.
		if (data.type === 'agent_end') {
			for (const fn of this.agentEndListeners) fn(data);
			return;
		}

		// Other events are ignored for now.
	}

	/**
	 * Respond to an `extension_ui_request` by writing an
	 * `extension_ui_response` on stdin. For dialog methods we
	 * `cancelled: true`; for `notify` / `setStatus` / `setTitle` we
	 * send a stub `value: ""` (the subagent does not need an answer
	 * for fire-and-forget methods).
	 */
	private respondToUiRequest(id: string, method: unknown): void {
		const m = typeof method === 'string' ? method : '';
		let payload: Record<string, unknown>;
		if (m === 'confirm' || m === 'select' || m === 'input' || m === 'editor') {
			payload = { type: 'extension_ui_response', id, cancelled: true };
		} else {
			// notify / setStatus / setTitle / set_editor_text / setWidget: no
			// real answer needed; send an empty `value` so the subagent
			// can move on.
			payload = { type: 'extension_ui_response', id, value: '' };
		}
		this.writeCommand(payload);
	}

	/** Send a JSON-RPC command and await the response. */
	private sendCommand(command: Record<string, unknown>): Promise<unknown> {
		if (!this.proc?.stdin) {
			return Promise.reject(new Error('Client not started'));
		}
		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id };
		return new Promise((resolve, reject) => {
			this.pending = { id, resolve, reject, command: String(command.type ?? 'unknown') };
			this.writeCommand(fullCommand);
		});
	}

	/** Write a command to the subagent's stdin. */
	private writeCommand(command: Record<string, unknown>): void {
		if (!this.proc?.stdin) {
			throw new Error('Client not started');
		}
		(this.proc.stdin as Writable).write(serializeJsonLine(command));
	}

	/** Issue a `get_state` command. */
	private async getState(): Promise<{ sessionId: string; sessionName?: string }> {
		const response = (await this.sendCommand({ type: 'get_state' })) as {
			data?: { sessionId?: string; sessionName?: string };
		};
		return {
			sessionId: response.data?.sessionId ?? '',
			sessionName: response.data?.sessionName,
		};
	}

	/** Issue a `get_last_assistant_text` command. */
	private async getLastAssistantText(): Promise<string | null> {
		const response = (await this.sendCommand({ type: 'get_last_assistant_text' })) as {
			data?: { text?: string | null };
		};
		return response.data?.text ?? null;
	}

	/**
	 * Stop the spawned process. SIGTERM first, then SIGKILL after 1s
	 * if the process is still alive. Resolves once the process exits.
	 */
	async stop(): Promise<void> {
		if (!this.proc) return;
		const proc = this.proc;
		proc.kill('SIGTERM');
		await new Promise<void>((resolve) => {
			const t = setTimeout(() => {
				proc.kill('SIGKILL');
				resolve();
			}, 1000);
			proc.once('exit', () => {
				clearTimeout(t);
				resolve();
			});
		});
		this.proc = null;
		this.pending = null;
		this.runRejectExit = null;
	}
}

/** Map a tool name to a parent-visible phase. */
function toolNameToPhase(name: string): ToolPhase {
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

// =========================================================================
// Strict-JSONL helpers (inlined; the upstream
// `@mariozechner/pi-coding-agent/dist/modes/rpc/jsonl.js` is not exposed
// by the package's `exports` field).
// =========================================================================

/**
 * Serialize a single strict JSONL record. LF-only framing.
 */
export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Attach an LF-only JSONL reader to a stream. The reader does NOT use
 * Node `readline` (which splits on U+2028 / U+2029 — both valid inside
 * JSON strings). It splits on `\n` only, joining `\r\n` to `\n` for
 * tolerant input.
 */
export function attachJsonlLineReader(
	stream: Readable,
	onLine: (line: string) => void,
): () => void {
	const decoder = new StringDecoder('utf8');
	let buffer = '';
	const emitLine = (line: string) => {
		onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
	};
	const onData = (chunk: Buffer | string) => {
		buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
		while (true) {
			const newlineIndex = buffer.indexOf('\n');
			if (newlineIndex === -1) return;
			emitLine(buffer.slice(0, newlineIndex));
			buffer = buffer.slice(newlineIndex + 1);
		}
	};
	const onEnd = () => {
		buffer += decoder.end();
		if (buffer.length > 0) {
			emitLine(buffer);
			buffer = '';
		}
	};
	stream.on('data', onData);
	stream.on('end', onEnd);
	return () => {
		stream.off('data', onData);
		stream.off('end', onEnd);
	};
}
