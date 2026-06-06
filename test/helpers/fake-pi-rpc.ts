/**
 * Fake PiRpcClient for testing
 *
 * Mirrors the event API of `extensions/pi-rpc-client.ts` without spawning
 * a real subprocess. Tests can:
 *
 * - register `onText` / `onTool` / `onThinking` listeners (via the
 *   public `PiRpcClient` API),
 * - drive events with `emitText` / `emitTool` / `emitThinking`,
 * - finish the run with `finish({ text, sessionId, sessionName })`,
 * - simulate a non-zero exit with `failWithError(exitCode, stderr)`,
 * - simulate a timeout (just don't call `finish()`).
 *
 * Internally the fake is a `PiRpcClient` whose `spawn` factory is
 * replaced with one that returns a child-process-shaped fake driving
 * the wrapper's `handleLine` directly. Stdin writes are intercepted
 * to track pending commands; responses are queued and pushed on
 * stdout when the matching command is written.
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { spawn as nodeSpawn } from 'node:child_process';
import { PiRpcClient, type PiRpcToolEvent } from '../../extensions/pi-rpc-client.js';

export interface FakePiRpcConfig {
	/** Final assistant text returned by `get_last_assistant_text`. */
	finalText?: string;
	/** Live session id returned by `get_state`. */
	sessionId?: string;
	/** Live session name returned by `get_state`. */
	sessionName?: string;
	/** Simulated exit code on `agent_end` (default 0). */
	exitCode?: number;
	/**
	 * If true (default true), the fake auto-responds to known
	 * commands (`prompt` → success, `get_state` → sessionId, etc.)
	 * when the wrapper writes them on stdin. If false, the test
	 * must push the matching response line on stdout manually.
	 */
	autoRespond?: boolean;
}

export interface FakeChildProcess {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	emit(event: 'exit', code: number | null): boolean;
	on(event: 'exit', listener: (code: number | null) => void): this;
	kill(signal?: string): void;
}

/** Build a child-process-shaped fake that the wrapper can drive. */
function createFakeChild(): FakeChildProcess & EventEmitter {
	const ee = new EventEmitter();
	const stdin = new Writable({
		write(_chunk, _enc, cb) {
			cb();
		},
	});
	const stdout = new Readable({ read() {} });
	const stderr = new Readable({ read() {} });
	return Object.assign(ee, {
		stdin,
		stdout,
		stderr,
		kill: (_sig?: string) => {
			// No-op; tests drive the lifecycle manually.
		},
	}) as FakeChildProcess & EventEmitter;
}

/**
 * Build a spawn factory that always returns the given child fake.
 * The factory signature matches `child_process.spawn`. The cast
 * goes through `unknown` to the real `spawn` type (the union
 * overloads of the real spawn are too narrow for a single
 * factory signature to satisfy directly).
 */
function makeSpawnFactory(child: FakeChildProcess & EventEmitter): typeof nodeSpawn {
	return ((..._args: unknown[]) => child) as unknown as typeof nodeSpawn;
}

/**
 * Create a fake `PiRpcClient`. Returns:
 * - the client (call `client.run(...)`),
 * - a `driver` with helpers to emit events and finish the run.
 */
export function createFakePiRpc(config: FakePiRpcConfig = {}): {
	client: PiRpcClient;
	driver: FakePiRpcDriver;
} {
	const child = createFakeChild();
	const driver = new FakePiRpcDriver(child, config);
	const client = new PiRpcClient({
		piPath: 'fake-pi',
		cwd: '/tmp/fake',
		env: {},
		spawn: makeSpawnFactory(child),
	});
	return { client, driver };
}

/**
 * Create a fake `PiRpcClient` with a custom spawn that records
 * the argv before returning the child. Useful for argv-shape
 * assertions. The returned `spawnCalls` array is mutated as the
 * wrapper spawns the subprocess.
 */
export function createFakePiRpcWithSpawnCapture(
	config: FakePiRpcConfig = {},
): {
	client: PiRpcClient;
	driver: FakePiRpcDriver;
	spawnCalls: Array<{ command: string; args: string[] }>;
} {
	const child = createFakeChild();
	const driver = new FakePiRpcDriver(child, config);
	const spawnCalls: Array<{ command: string; args: string[] }> = [];
	const client = new PiRpcClient({
		piPath: 'pi',
		cwd: '/tmp/fake',
		env: {},
		args: [],
		spawn: ((command: string, args: string[]) => {
			spawnCalls.push({ command, args: [...args] });
			return child as unknown as ReturnType<typeof nodeSpawn>;
		}) as unknown as typeof nodeSpawn,
	});
	return { client, driver, spawnCalls };
}

/** Helpers for driving a `FakePiRpc` from a test. */
export class FakePiRpcDriver {
	readonly child: FakeChildProcess & EventEmitter;
	readonly config: Required<FakePiRpcConfig>;
	readonly writes: string[] = [];

	private autoRespond: boolean;
	private exited = false;
	/** Set by `failWithError` to suppress auto-respond for the failure path. */
	private failed = false;
	/**
	 * Pending command ids: the wrapper has written a command on
	 * stdin and is waiting for a response. When this set is empty
	 * after a `finish()` call, all responses have been sent and
	 * we can emit exit.
	 */
	private pendingResponses = new Set<string>();
	/** True when `finish()` has been called; used to gate exit emission. */
	private finishCalled = false;

	constructor(child: FakeChildProcess & EventEmitter, config: FakePiRpcConfig) {
		this.child = child;
		this.config = {
			finalText: config.finalText ?? '',
			sessionId: config.sessionId ?? 'fake-session-id',
			sessionName: config.sessionName ?? 'fake-session-name',
			exitCode: config.exitCode ?? 0,
			autoRespond: config.autoRespond ?? true,
		};
		this.autoRespond = this.config.autoRespond;
		// Intercept stdin writes so we can:
		// 1. Capture them for test inspection (`writes`).
		// 2. Auto-respond to known commands.
		const origWrite = child.stdin.write.bind(child.stdin);
		child.stdin.write = (chunk: unknown, ...rest: unknown[]): boolean => {
			if (typeof chunk === 'string') {
				this.writes.push(chunk);
				if (this.autoRespond) this.autoRespondToCommand(chunk);
			}
			// @ts-expect-error variadic
			return origWrite(chunk, ...rest);
		};
	}

	/**
	 * If the chunk is a JSON-RPC command we know how to answer,
	 * push the matching response on stdout on the next microtask.
	 */
	private autoRespondToCommand(chunk: string): void {
		let cmd: Record<string, unknown>;
		try {
			cmd = JSON.parse(chunk) as Record<string, unknown>;
		} catch {
			return;
		}
		const id = cmd.id;
		if (typeof id !== 'string') return;
		const type = cmd.type;
		let data: unknown = null;
		if (type === 'prompt' || type === 'steer' || type === 'follow_up' || type === 'abort' || type === 'set_session_name') {
			data = null; // success-only response
		} else if (type === 'get_state') {
			data = { sessionId: this.config.sessionId, sessionName: this.config.sessionName };
		} else if (type === 'get_last_assistant_text') {
			data = { text: this.config.finalText };
		} else {
			// Unknown command: respond with empty success so the
			// wrapper doesn't hang.
			data = null;
		}
		// Track this command as pending a response. The exit
		// emission in `finish()` is gated on this set being empty
		// so the wrapper's `get_state` / `get_last_assistant_text`
		// calls always receive their responses before the fake
		// process exits.
		this.pendingResponses.add(id);
		// Push the response asynchronously so the wrapper is in its
		// `pending` state when the response arrives.
		setImmediate(() => {
			if (this.failed) return;
			this.pendingResponses.delete(id);
			this.emitLine(
				JSON.stringify({
					type: 'response',
					id,
					success: true,
					...(data !== null ? { data } : {}),
				}),
			);
			// If finish() has been called and all responses have
			// been sent, emit exit. This mirrors the real `pi`
			// flow: the subagent responds to trailing commands
			// before exiting.
			if (this.finishCalled && this.pendingResponses.size === 0) {
				this.child.emit('exit', this.config.exitCode);
			}
		});
	}

	/** Push a single JSONL line to the fake's stdout. */
	emitLine(line: string): void {
		this.child.stdout.push(`${line}\n`);
	}

	/** Push a `message_update` `text_delta` event. */
	emitText(delta: string): void {
		this.emitLine(
			JSON.stringify({
				type: 'message_update',
				message: { role: 'assistant' },
				assistantMessageEvent: { type: 'text_delta', delta },
			}),
		);
	}

	/** Push a `message_update` `thinking_delta` event. */
	emitThinking(delta: string): void {
		this.emitLine(
			JSON.stringify({
				type: 'message_update',
				message: { role: 'assistant' },
				assistantMessageEvent: { type: 'thinking_delta', delta },
			}),
		);
	}

	/** Push a `tool_execution_start` event. */
	emitTool(name: string, args: unknown = {}): void {
		this.emitLine(
			JSON.stringify({
				type: 'tool_execution_start',
				toolCallId: `call_${Math.random().toString(36).slice(2)}`,
				toolName: name,
				args,
			}),
		);
	}

	/** Push a `tool_execution_end` event. */
	emitToolEnd(name: string, result: unknown = {}, isError = false): void {
		this.emitLine(
			JSON.stringify({
				type: 'tool_execution_end',
				toolCallId: `call_${Math.random().toString(36).slice(2)}`,
				toolName: name,
				result,
				isError,
			}),
		);
	}

	/** Push an `extension_ui_request` event. */
	emitUiRequest(method: string, id = 'ui_1'): void {
		this.emitLine(
			JSON.stringify({
				type: 'extension_ui_request',
				id,
				method,
			}),
		);
	}

	/**
	 * Push the `agent_end` event and mark the fake as finished.
	 * The exit is emitted only after all pending auto-respond
	 * responses have been sent (i.e. the wrapper's
	 * `get_state` / `get_last_assistant_text` calls have been
	 * answered). If no commands are pending when finish() is
	 * called, the exit fires on the next microtask. This matches
	 * the real `pi` flow: the subagent emits `agent_end`,
	 * responds to `get_state` / `get_last_assistant_text`, and
	 * only then exits.
	 */
	finish(): Promise<void> {
		// Push agent_end synchronously.
		this.emitLine(JSON.stringify({ type: 'agent_end', messages: [] }));
		this.exited = true;
		this.finishCalled = true;
		// If no responses are pending (e.g. finish was called
		// before the wrapper wrote any command), emit exit on
		// the next microtask so the test's `await runPromise`
		// has a chance to park first.
		if (this.pendingResponses.size === 0) {
			queueMicrotask(() => {
				this.child.emit('exit', this.config.exitCode);
			});
		}
		// The wrapper's run() resolves on the responses to
		// get_state and get_last_assistant_text. Those are pushed
		// by autoRespondToCommand when the wrapper writes them.
		// Tests should `await runPromise` after calling finish().
		return Promise.resolve();
	}

	/** Simulate a non-zero exit (no `agent_end`). */
	failWithError(exitCode: number, stderr = ''): void {
		// Drain stdout/stderr so any pending readers see end-of-stream.
		this.child.stdout.push(null);
		this.child.stderr.push(stderr);
		this.child.stderr.push(null);
		this.exited = true;
		this.failed = true;
		this.child.emit('exit', exitCode);
	}
}
