import { describe, it, expect } from 'vitest';
import { PiRpcClient } from '../extensions/pi-rpc-client.js';
import { createFakePiRpc, createFakePiRpcWithSpawnCapture } from './helpers/fake-pi-rpc.js';

/**
 * Yield until all pending microtasks have run. The fake's data
 * events fire synchronously when the JSONL reader is attached
 * (which happens in `run()`'s `start()` microtask). Tests that
 * push data after `client.run(...)` must yield first, otherwise
 * the data is pushed before the reader is attached and gets
 * processed without any active listeners.
 */
const yieldMicrotasks = () => new Promise<void>((r) => setImmediate(r));

describe('PiRpcClient', () => {
	describe('argv', () => {
		it('spawns `pi` with --mode rpc and the existing --name / --session-id / --tools / --skill / --no-extensions flags', async () => {
			const { driver, spawnCalls } = createFakePiRpcWithSpawnCapture();
			// Re-construct the client with the full set of args.
			const { PiRpcClient: Cls } = await import('../extensions/pi-rpc-client.js');
			const child = (driver as unknown as { child: import('node:stream').Readable & { stdin: import('node:stream').Writable; emit: (e: string, c: number | null) => boolean; on: (e: string, l: (c: number | null) => void) => unknown } }).child;
			const fullClient = new Cls({
				piPath: 'pi',
				cwd: '/tmp/work',
				env: {},
				args: [
					'--name', 'webfetch-research: example.com',
					'--session-id', 'abc123',
					'--tools', 'read,grep,find,ls,bash',
					'--skill', '/path/to/skill',
					'--no-extensions',
				],
				spawn: ((command: string, args: string[]) => {
					spawnCalls.push({ command, args: [...args] });
					return child as never;
				}) as never,
			});

			const runPromise = fullClient.run({ prompt: 'hello' });
			await yieldMicrotasks();
			driver.emitLine(JSON.stringify({ type: 'agent_end', messages: [] }));
			driver.finish();
			await runPromise;

			expect(spawnCalls.length).toBe(1);
			const call = spawnCalls[0];
			expect(call.command).toBe('pi');
			// First two args must be --mode rpc.
			expect(call.args[0]).toBe('--mode');
			expect(call.args[1]).toBe('rpc');
			// Existing flags threaded through `args` unchanged.
			expect(call.args).toContain('--name');
			expect(call.args).toContain('webfetch-research: example.com');
			expect(call.args).toContain('--session-id');
			expect(call.args).toContain('abc123');
			expect(call.args).toContain('--tools');
			expect(call.args).toContain('read,grep,find,ls,bash');
			expect(call.args).toContain('--skill');
			expect(call.args).toContain('/path/to/skill');
			expect(call.args).toContain('--no-extensions');
		});
	});

	describe('event dispatch', () => {
		it('fires onText for every coalesced chunk; concatenation is byte-equal to the input deltas', async () => {
			const { client, driver } = createFakePiRpc({ finalText: 'final text' });
			const chunks: string[] = [];
			client.onText((delta) => chunks.push(delta));

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitText('Hello, ');
			driver.emitText('world');
			driver.emitText('!');
			driver.finish();
			const result = await runPromise;

			// The wrapper debounces: the concatenated chunks equal
			// the full text (no loss, no duplication).
			const concatenated = chunks.join('');
			expect(concatenated).toBe('Hello, world!');
			expect(result.text).toBe('final text');
		});

		it('fires onTool with { phase: reading, name, args } for read / grep / find / ls', async () => {
			const { client, driver } = createFakePiRpc({ finalText: '' });
			const events: Array<{ phase: string; name: string; args: unknown }> = [];
			client.onTool((e) => events.push(e));

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitTool('read', { path: '/tmp/input.md' });
			driver.emitTool('grep', { pattern: 'foo' });
			driver.emitTool('find', { pattern: '*.ts' });
			driver.emitTool('ls', { path: '/tmp' });
			driver.finish();
			await runPromise;

			expect(events.map((e) => e.phase)).toEqual(['reading', 'reading', 'reading', 'reading']);
			expect(events.map((e) => e.name)).toEqual(['read', 'grep', 'find', 'ls']);
		});

		it('fires onTool with { phase: executing, name, args } for bash', async () => {
			const { client, driver } = createFakePiRpc();
			const events: Array<{ phase: string; name: string; args: unknown }> = [];
			client.onTool((e) => events.push(e));

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitTool('bash', { command: 'ls /tmp' });
			driver.finish();
			await runPromise;

			expect(events[0].phase).toBe('executing');
			expect(events[0].name).toBe('bash');
			expect(events[0].args).toEqual({ command: 'ls /tmp' });
		});

		it('fires onTool with { phase: thinking, name, args } for unknown tools', async () => {
			const { client, driver } = createFakePiRpc();
			const events: Array<{ phase: string; name: string; args: unknown }> = [];
			client.onTool((e) => events.push(e));

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitTool('webfetch', { url: 'https://example.com' });
			driver.finish();
			await runPromise;

			expect(events[0].phase).toBe('thinking');
			expect(events[0].name).toBe('webfetch');
		});

		it('flushes the text buffer on tool_execution_start', async () => {
			const { client, driver } = createFakePiRpc();
			const chunks: string[] = [];
			client.onText((delta) => chunks.push(delta));

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitText('leading ');
			driver.emitText('text');
			// The tool event flushes the buffer immediately. We
			// yield once to let the data event fire and the tool
			// handler flush.
			driver.emitTool('read', { path: '/tmp/input.md' });
			await new Promise((r) => setImmediate(r));
			expect(chunks.join('')).toBe('leading text');

			driver.finish();
			await runPromise;
		});
	});

	describe('extension_ui_request auto-dismiss', () => {
		it('drops notify / setStatus / setTitle events (no error)', async () => {
			const { client, driver } = createFakePiRpc();
			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitUiRequest('notify');
			driver.emitUiRequest('setStatus');
			driver.emitUiRequest('setTitle');
			driver.finish();
			await expect(runPromise).resolves.toBeDefined();
		});

		it('responds to confirm with { type: extension_ui_response, id, cancelled: true }', async () => {
			const { client, driver } = createFakePiRpc();

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitUiRequest('confirm', 'ui_42');
			// Give the wrapper a tick to write the response.
			await new Promise((r) => setImmediate(r));
			const dismissLine = driver.writes.find((w) => w.includes('extension_ui_response'));
			expect(dismissLine).toBeDefined();
			const parsed = JSON.parse((dismissLine as string).trim());
			expect(parsed.type).toBe('extension_ui_response');
			expect(parsed.id).toBe('ui_42');
			expect(parsed.cancelled).toBe(true);

			driver.finish();
			await runPromise;
		});

		it('leaves extension_ui_request events un-handled when autoDismissUiRequests is false', async () => {
			const { driver } = createFakePiRpc();
			// Re-build with autoDismissUiRequests: false.
			const { PiRpcClient: Cls } = await import('../extensions/pi-rpc-client.js');
			const child = (driver as unknown as { child: import('node:stream').Readable & { stdin: import('node:stream').Writable; emit: (e: string, c: number | null) => boolean } }).child;
			const clientNoAuto = new Cls({
				piPath: 'fake-pi',
				cwd: '/tmp/fake',
				env: {},
				args: [],
				autoDismissUiRequests: false,
				spawn: ((_command: string, _args: string[], _options: object) =>
					child) as never,
			});

			const runPromise = clientNoAuto.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.emitUiRequest('confirm', 'ui_99');
			await new Promise((r) => setImmediate(r));
			// No auto-dismiss line should have been written.
			const dismissLine = driver.writes.find((w) => w.includes('extension_ui_response'));
			expect(dismissLine).toBeUndefined();

			driver.finish();
			await runPromise;
		});
	});

	describe('error paths', () => {
		it('rejects with PiAgentError on non-zero exit (no agent_end)', async () => {
			const { client, driver } = createFakePiRpc();
			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			driver.failWithError(1, 'something bad');
			await expect(runPromise).rejects.toThrow(/pi exited with code 1/);
		});

		it('rejects with PiAgentError on timeout (no agent_end in time)', async () => {
			const { client } = createFakePiRpc();
			await expect(
				client.run({ prompt: 'hi', timeoutMs: 30 }),
			).rejects.toThrow(/timed out after 30ms/);
		});

		it('does not trip a 30s per-command limit when timeoutMs is 300000', async () => {
			// The upstream RpcClient has a 30s hard-coded per-command
			// timeout. The wrapper does not use RpcClient, so a 5min
			// timeout must not be capped to 30s. We assert this
			// indirectly: with a 200ms timeout and no agent_end, the
			// wrapper rejects with the configured timeoutMs value, not
			// a constant 30s.
			const { client } = createFakePiRpc();
			await expect(
				client.run({ prompt: 'hi', timeoutMs: 200 }),
			).rejects.toThrow(/timed out after 200ms/);
		});

		it('does not surface a second unhandled rejection when run() times out', async () => {
			// BUG-2026-06-17-JGCMZSET-CRONO: a timed-out run()
			// rejection propagated as `unhandledRejection`, which
			// crashed the host pi agent. Root cause: the inner
			// cleanup chain attached `.finally(() => ...)` to
			// `agentEndPromise` and discarded the returned promise.
			// When the run rejected, the `.finally()` mirror
			// promise had no `.catch` and fired unhandledRejection.
			// The fix is to attach `.catch(() => {})` so the
			// cleanup mirror cannot leak the run's rejection.
			//
			// We pin the fix by capturing any
			// `unhandledRejection` / `uncaughtException` that fires
			// during a timed-out run and asserting the timeout
			// rejection is the ONLY thing that fires (and only on
			// the awaited promise, never as unhandled).
			const unhandled: unknown[] = [];
			const onUnhandled = (reason: unknown) => unhandled.push(reason);
			process.on('unhandledRejection', onUnhandled);
			process.on('uncaughtException', onUnhandled);
			try {
				const { client } = createFakePiRpc();
				await expect(
					client.run({ prompt: 'hi', timeoutMs: 30 }),
				).rejects.toThrow(/timed out after 30ms/);
				// Let any pending microtasks / timers resolve so
				// the unhandledRejection event (if any) has a
				// chance to fire.
				await new Promise((r) => setTimeout(r, 50));
				expect(unhandled).toEqual([]);
			} finally {
				process.off('unhandledRejection', onUnhandled);
				process.off('uncaughtException', onUnhandled);
			}
		});
	});

	describe('text coalescing', () => {
		it('concatenated onText output is byte-equal to the input deltas (no loss, no duplication)', async () => {
			const { client, driver } = createFakePiRpc();
			const chunks: string[] = [];
			client.onText((delta) => chunks.push(delta));

			const runPromise = client.run({ prompt: 'hi' });
			await yieldMicrotasks();
			const total = 100;
			const parts: string[] = [];
			for (let i = 0; i < total; i++) {
				const delta = `d${i}`;
				parts.push(delta);
				driver.emitText(delta);
			}
			driver.finish();
			const result = await runPromise;

			// The concatenated text from the listener must equal the
			// concatenation of all emitted deltas (the debouncing is
			// invisible to the consumer).
			const concatenated = chunks.join('');
			expect(concatenated).toBe(parts.join(''));
			// And the final result text is the value the fake
			// returned for `get_last_assistant_text`.
			expect(result.text).toBe('');
		});
	});
});
