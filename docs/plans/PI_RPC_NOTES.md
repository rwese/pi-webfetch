# PI RPC Notes

> **SUPERSEDED (2026-09-01).** The research subagent no longer uses the
> `pi --mode rpc` JSON-RPC transport. It is now a direct in-process
> `AgentSession` from the `@earendil-works/pi-coding-agent` SDK — see
> `docs/plans/PLAN_SDK_IN_PROCESS.md`. `extensions/pi-rpc-client.ts` was
> removed; `extensions/pi-session.ts` replaces it. The notes below are kept
> for historical context only.

Implementation notes for the `pi --mode rpc` transport used by
`extensions/pi-rpc-client.ts` (removed) and consumed by `extensions/pi-agent.ts`.

The wrapper is a thin JSON-RPC client that drives `pi` over stdio.
The previous print-mode `-p <prompt>` spawn is gone; the subagent
is a real, named, persistent pi session that streams text deltas
and tool events back to the parent. See
`docs/plans/PLAN_PI_JSONRPC.md` for the design rationale.

## Protocol Quirks

### LF-only JSONL framing

The upstream `pi --mode rpc` uses **strict LF-only JSONL** on
stdout. The wrapper's `attachJsonlLineReader` is a hand-rolled
LF-only splitter; we do **not** use Node's `readline` because
`readline` splits on U+2028 and U+2029, both of which are valid
inside JSON strings. A model that returns content with a U+2028
inside a string literal would be split at the wrong boundary and
the parent's `JSON.parse` would silently drop data.

The reader also normalizes `\r\n` to `\n` for tolerant input on
Windows.

The serialize helper is the inverse: `JSON.stringify(value) + '\n'`.
No custom framing, no length prefix — the upstream protocol is
plain JSONL.

### `extension_ui_request` auto-dismiss policy

The upstream extension UI can request user input mid-run
(`confirm`, `select`, `input`, `editor`) or push notifications
(`notify`, `setStatus`, `setTitle`, `set_editor_text`,
`setWidget`). The research subagent never needs parent interaction,
so the wrapper auto-dismisses by default:

- Dialog methods (`confirm`, `select`, `input`, `editor`) get
  `{ type: 'extension_ui_response', id, cancelled: true }`.
- Fire-and-forget methods (`notify`, `setStatus`, `setTitle`,
  `set_editor_text`, `setWidget`) get
  `{ type: 'extension_ui_response', id, value: '' }` so the
  subagent can move on.

Auto-dismiss is on by default and is opt-out via
`PiRpcClientOptions.autoDismissUiRequests: false`. The parent
that wants to surface dialogs would set this to `false` and
handle the `extension_ui_request` events itself.

### Spawn `pi` directly (not `node dist/cli.js`)

The wrapper spawns the `pi` binary directly:

```
pi --mode rpc --name <name> --session-id <id> --tools <csv> \
   --skill <path> --no-extensions
```

Spawning `node dist/extensions/cli.js mcp` (the previous MCP
entrypoint shape) would add a Node cold-start on the order of
tens of milliseconds to every subagent invocation. The `pi`
binary is the same `node` process that the parent runs; using
`pi` directly is the right shape.

The wrapper's `piPath` option defaults to `'pi'`, resolved via
PATH. Tests inject a custom `spawn` factory; production callers
can override `piPath` to point at a specific binary.

### `getState()` is the source of truth for session ids

`spawnPiAgent` threads a pre-computed `--session-id <id>` and
`--name <name>` to the subagent so the user can `pi --session
<id>` into the failed transcript after an error
(`docs/plans/PLAN_AGENT_ERROR_RESUME.md`).

The `PiRpcClient` does not assume the pre-computed id is what
the subagent actually used. After `agent_end`, the wrapper
issues a `get_state` command and uses the **live** session id
and session name as the source of truth for
`SpawnPiAgentResult.sessionId` / `SpawnPiAgentResult.sessionName`.

If `get_state` returns empty (the subagent exited before the
command could resolve), `spawnPiAgent` falls back to the
pre-computed values. In that case the resume command may point
at a non-existent session, but the error path is already
catching a `PiAgentError` so the parent surfaces a hard error
to the user.

### Single-path timeout (wrapper-owned `agent_end` waiter)

The wrapper owns the wall-clock budget for the run. A single
`setTimeout(timeoutMs)` fires on `agent_end` timeout; on fire,
it clears the run-reject hook, sends `SIGTERM` to the child,
then `SIGKILL` after 1s, and rejects with
`PiAgentError('Pi agent timed out after Xms', null)`.

The upstream `RpcClient` has a 30s hard-coded per-command
timeout that would cap any sub-second budget at 30s. The
wrapper does not use `RpcClient`; it issues `get_state` and
`get_last_assistant_text` directly, so a 5-minute timeout is
not capped. See `test/pi-rpc-client.test.ts` "does not trip a
30s per-command limit" for the regression test.

The prompt command itself is fire-and-forget: the wrapper
does not await the prompt's response, because the trailing
`get_state` / `get_last_assistant_text` would overwrite the
single pending slot. The prompt is "accepted" once it has been
written to stdin; the `agent_end` event is the source of truth
for completion.

### One pending command at a time

The upstream protocol allows multiple in-flight commands, but
the research subagent is single-turn (one prompt, one response).
The wrapper tracks at most one pending command at a time,
matched by `id`. A response with a mismatched `id` is dropped
(not an error); this is what allows the prompt's response to
be safely discarded when `get_state` overwrites the slot.

### Exit-handler rejection

The child process can exit for two reasons:

1. Normal exit after `agent_end` — the run has already
   resolved; the exit handler is a no-op.
2. Abnormal exit (non-zero code, signal, no `agent_end`) — the
   exit handler rejects the in-flight run with
   `PiAgentError('pi exited with code N: <stderr>', N, <stderr>)`.
   A pending command's promise is rejected with
   `PiAgentError('pi exited (code N) before responding to <cmd>: ...')`.

The two rejection paths are independent: a non-zero exit
rejects both the in-flight run and any pending command. The
pending command's rejection is caught inside the wrapper's
`run()` flow; the run rejection is the one the caller sees.

### Response matching by id

Responses are matched to commands by `id`. The wrapper assigns
`id: req_<n>` to each command. A response with a `success: false`
field rejects the command with the upstream error message. A
response with a `success: true` field resolves the command with
the `data` payload (e.g. `{ sessionId, sessionName }` for
`get_state`, `{ text }` for `get_last_assistant_text`).

### Tool events: phase mapping

The wrapper maps tool names from `tool_execution_start` events
to a parent-friendly phase union:

- `read` / `grep` / `find` / `ls` → `'reading'`
- `bash` → `'executing'`
- everything else → `'thinking'`

The parent uses these phases directly in its streaming updates
(`extensions/fetch-phases.ts` has matching labels:
`'📖 Reading input...'`, `'🔧 Running command...'`,
`'💭 Thinking...'`). See `docs/plans/PLAN_PI_JSONRPC.md` for
the rationale.

### Text coalescing

The wrapper coalesces `message_update` `text_delta` events in
a small buffer and flushes on a 16ms cadence (one frame at
60fps). A `tool_execution_start` event between deltas flushes
the buffer immediately so the user sees the text leading up to
the tool call before the tool call itself. The `agent_end`
event flushes the final text.

The total text the listener receives is **byte-equal** to the
concatenation of all emitted deltas (the debouncing is
invisible to the consumer). See
`test/pi-rpc-client.test.ts` "concatenated onText output is
byte-equal to the input deltas" for the regression test.

## Why not subclass `RpcClient`?

The upstream `@mariozechner/pi-coding-agent` exports an
`RpcClient` class that already handles the JSON-RPC transport.
We considered subclassing it but rejected for these reasons:

1. **Single pending slot vs. multi-command**: the upstream
   `RpcClient` queues commands and dispatches them in order.
   The research subagent is single-turn; the wrapper has
   one-shot semantics that don't need a queue.
2. **Per-command 30s timeout**: the upstream `RpcClient` has a
   30s hard-coded timeout per command. The wrapper's
   run-level timeout is 180s (DEFAULT_PI_AGENT_TIMEOUT_MS) and
   is not capped.
3. **extension_ui_request policy**: the upstream `RpcClient`
   has no notion of auto-dismiss; the wrapper's default policy
   is to silence all `extension_ui_request` events from the
   subagent.
4. **Test surface**: subclassing `RpcClient` would force
   tests to mock the upstream class, which is tightly coupled
   to its own internals. A 50-line wrapper with two LF-only
   helpers is a smaller, more focused test surface.

The trade-off is that the wrapper does not benefit from
upstream bug fixes. The wrapper is small enough that
maintaining a fork is tractable; if the upstream adds a
feature we need, we can revisit.

## Related

- `docs/plans/PLAN_PI_JSONRPC.md` — design plan
- `docs/plans/PLAN_AGENT_ERROR_RESUME.md` — resume flow that
  uses the live `getState().sessionId` from this wrapper
- `extensions/pi-rpc-client.ts` — the wrapper
- `extensions/pi-agent.ts` — the consumer
- `extensions/services/research-service.ts` — wires the
  tool-event phase to the FetchPhase union for live UX
- `test/pi-rpc-client.test.ts` — wrapper tests (13 cases)
- `test/helpers/fake-pi-rpc.ts` — fake child fake for tests
