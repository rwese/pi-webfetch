---
state: approved
needed: true
reviewed: 2026-09-01
notes: 'Approved 2026-09-01. Implementation merged; see CHANGELOG.md. Refactor the research subagent from a spawned `pi --mode rpc` subprocess to a direct in-process `AgentSession` from the `@earendil-works/pi-coding-agent` SDK, with pi-webfetch-managed tools, model, and API keys.'
---

# Plan: Integrate the pi coding agent SDK in-process

## Context

<goal syntax="markdown">Replace the spawned `pi --mode rpc` subprocess used for research queries with a direct, in-process `AgentSession` created via the `@earendil-works/pi-coding-agent` SDK's `createAgentSession`. The research subagent's tools, model, and API keys are managed by pi-webfetch itself (via the SDK's tool allowlist and an isolated `ModelRuntime`), so a pre-configured `pi` runtime instance is no longer required. The public `spawnPiAgent(...)` surface stays source-compatible: same options, same `SpawnPiAgentResult`, same `onChunk` / `onToolCall` / `onThinking` callbacks, same `PiAgentError`, same timeout semantics, same resumable-session contract.</goal>

Today the research subagent is spawned as a real `pi` subprocess in `--mode rpc` mode and driven over a hand-rolled JSON-RPC transport (`extensions/pi-rpc-client.ts`, 650 lines). This has several costs:

1. **Requires a pre-configured `pi` on PATH** — the subprocess is the user's `pi` binary reading the user's `~/.pi/agent/auth.json`, `models.json`, skills, and settings. We have no control over its tools, API key source, or model resolution beyond argv flags.
2. **Cold-start on every research call** — the `pi` subprocess boots (model + provider init) before it can answer; ~6s warm in practice.
3. **A 650-line transport to maintain** — the JSON-RPC framing, request/response correlation, timeout state machine, and `extension_ui_request` auto-dismiss policy are all hand-rolled.
4. **Version drift risk** — eliminated by pinning the official `@earendil-works/*@0.84.4` packages and importing the same SDK the pi host bundles.

The SDK already exposes an in-process `createAgentSession(options)` → `{ session, extensionsResult, modelFallbackMessage }`. `AgentSession` provides:

- `session.prompt(text)` — runs a turn, resolves on `agent_end` (via `waitForRetry()`).
- `session.subscribe(listener)` — fires `message_update` (with `assistantMessageEvent.type === "text_delta"` / `"thinking_delta"`), `tool_execution_start`, `agent_end`, etc. This is the same event surface the RPC wire used, so the existing `onChunk` / `onToolCall` / `onThinking` mapping applies 1:1.
- `session.sessionId` / `session.sessionName` / `session.setSessionName(name)` — resumable session identity.
- `session.setActiveToolsByName([...])` / the `tools` allowlist on `createAgentSession` — direct control over the subagent's toolset (the research allowlist `read, grep, find, ls, bash` maps exactly to the SDK's `ToolName` union).
- `session.abort()` + `session.dispose()` — timeout / cleanup.
- `session.model`, `setModel()` — model control.

For model + API keys, the SDK gives us explicit control:

- `ModelRuntime.create({ authPath, modelsPath, refreshOnCreate })` — build an isolated runtime (temp auth file, built-in models only, no network refresh).
- `modelRuntime.setRuntimeApiKey(provider, key)` — inject API keys without touching the user's `auth.json`.
- `modelRuntime.getModel(provider, id)` or `getModel(provider, id)` from `@earendil-works/pi-ai/compat` — select a model explicitly.

The lean-prompt design is preserved unchanged: `buildResearchPrompt` still references `inputFile` / `inputRawFile` paths and the subagent `read`s them on demand. The input-file write (`writeInputFiles`) and the `WebfetchDetails` contract (`workDir`, `inputFile`, `inputRawFile`, `subagentSessionId`, `subagentSessionName`, `resumeCommand`, `notify`) are untouched.

## Scope

### In scope

- **New `extensions/pi-session.ts`** — the in-process agent-session wrapper:
  - builds an `AgentSession` via `createAgentSession` with:
    - `tools` allowlist = `DEFAULT_RESEARCH_TOOLS` (`read, grep, find, ls, bash`),
    - an isolated `ModelRuntime` (temp auth file, pi-webfetch-managed keys),
    - `model` resolved from `SpawnPiAgentOptions.model` (or a default / env-driven fallback),
    - `sessionManager` seeded with the deterministic `sessionId` / `sessionName` so the resume contract (`pi --session <id>`) still resolves,
    - `cwd` from options,
  - subscribes to `message_update` `text_delta` (coalesced to a 16ms flush, byte-equal to delta concatenation), `thinking_delta`, `tool_execution_start` (mapped to the `reading` / `executing` / `thinking` phase union), and `agent_end`,
  - runs `session.prompt(prompt)` under a wall-clock `setTimeout(timeoutMs)` budget; on timeout, `session.abort()` and reject with `PiAgentError('Pi agent timed out after Xms', null)`,
  - collects the final assistant text from `session.messages` after `agent_end` (equivalent to `get_last_assistant_text`),
  - returns `{ analysis, exitCode: 0, sessionId, sessionName }`,
  - disposes the session in a `finally` block.
- **Rewrite `extensions/pi-agent.ts::spawnPiAgent`** to use `pi-session.ts`. The public API is unchanged:
  - `SpawnPiAgentOptions` — same fields (`timeout`, `model`, `cwd`, `env`, `onChunk`, `onToolCall`, `skills`, `extensions`, `noExtensions`, `sessionId`, `sessionName`, `url`, `inputFile`, `inputRawFile`). `skills` / `extensions` / `noExtensions` are accepted for back-compat but are no-ops in-process (the SDK session uses the `tools` allowlist; skills are a subagent-loading concern that the lean prompt does not need).
  - `SpawnPiAgentResult` — same shape (`analysis`, `exitCode`, `sessionId`, `sessionName`).
  - `PiAgentError` — same class.
  - `DEFAULT_PI_AGENT_TIMEOUT_MS`, `DEFAULT_RESEARCH_TOOLS`, `buildResearchPrompt`, `isPiAvailable` — unchanged. (`DEFAULT_RESEARCH_SKILLS` was removed — the `skills` option is a documented no-op post-refactor.)
- **New `extensions/pi-auth.ts`** (or fold into `pi-session.ts`) — explicit pi-webfetch-managed key/model resolution:
  - `ModelRuntime.create({ authPath: <tmp>, modelsPath: null, refreshOnCreate: false })`; apply runtime API keys from:
    1. an explicit key option (new `ResearchModelConfig.apiKey`, persisted in `pi-webfetch.json` via the existing `model-config.ts`),
    2. provider-specific env vars via `pi-ai`'s `getEnvApiKey(provider)` (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`),
  - model resolution: `modelRuntime.getModel(provider, id)` → if missing, `getModel(provider, id)` from `@earendil-works/pi-ai/compat` → if that also fails, a clear `PiAgentError` telling the user the model is not available.
- **Extend `extensions/model-config.ts`** — add optional `apiKey` to `ResearchModelConfig`, load/save it in `pi-webfetch.json`.
- **Remove `extensions/pi-rpc-client.ts`** and the test helper `test/helpers/fake-pi-rpc.ts`.
- **Pin `@earendil-works/*@0.84.4` as runtime `dependencies`** — `@earendil-works/pi-coding-agent` (+ `pi-ai`, `pi-tui`) become runtime imports (`createAgentSession`, `ModelRuntime`) used by the CLI / MCP / standalone paths. The pi host aliases `@mariozechner/*` to these same packages, so there is one SDK version.
- **Update tests**:
  - rewrite `test/pi-agent.test.ts` to mock `createAgentSession` (fake `AgentSession` driving `subscribe` events),
  - rewrite `test/pi-rpc-client.test.ts` → `test/pi-session.test.ts` (event mapping, timeout, abort, tool phases, session id),
  - keep `test/webfetch-research.test.ts` and `test/resume.test.ts` green (the `spawnPiAgent` public API is unchanged, so the research-service contract is untouched).
- **Docs**: `docs/plans/PI_RPC_NOTES.md` superseded by `PI_SDK_IN_PROCESS.md` notes; update `AGENTS.md` Architecture Notes, `README.md` configuration, `CHANGELOG.md`.

### Out of scope (deferred)

- **Multi-turn / steering / follow-up** into the research subagent. Single-turn research only (matches the current single-prompt contract).
- **Auto-resume / subagent-to-parent extensions.** The user can still `pi --session <id>` the transcript.
- **A sandboxed / cgroup-isolated subagent.** The security PRD (`docs/prds/subagent-sandbox/`) is a separate follow-up.
- **In-process skill loading.** The SDK's skills pipeline is not wired; `skills` / `extensions` options remain no-op for back-compat.
- **OAuth-based provider login flow** (the SDK's `/login`). pi-webfetch supports API-key auth (runtime keys + env vars); OAuth is out of scope.

## Acceptance Criteria

- [ ] `spawnPiAgent` no longer spawns a `pi` subprocess. No `node:child_process`, no `--mode rpc`, no JSON-RPC framing anywhere in `extensions/`.
- [ ] The research subagent runs in-process via `createAgentSession`. `session.prompt(prompt)` drives the turn; `subscribe()` streams `text_delta` / `thinking_delta` / `tool_execution_start` / `agent_end`.
- [ ] The tool allowlist is exactly `read, grep, find, ls, bash` (the SDK's `tools` option on `createAgentSession`). No `edit`, `write`, or other tools are exposed to the subagent.
- [ ] API keys are pi-webfetch-managed: isolated `ModelRuntime` + `setRuntimeApiKey` (explicit config key or provider env vars). The user's `~/.pi/agent/auth.json` is never read.
- [ ] The model is explicitly selected: `SpawnPiAgentOptions.model` → `modelRegistry.find` → `getModel` → clear error. No reliance on a pre-configured `pi` default-model selection.
- [ ] `SpawnPiAgentOptions`, `SpawnPiAgentResult`, `PiAgentError`, `onChunk`, `onToolCall`, `onThinking`, `DEFAULT_*`, `buildResearchPrompt`, `isPiAvailable` are source-compatible.
- [ ] `onChunk` fires for coalesced `text_delta` events; the concatenated `onChunk` output is byte-equal to the final assistant text.
- [ ] `onToolCall` fires with `{ phase, name, args }` for `tool_execution_start` (`read`/`grep`/`find`/`ls` → `'reading'`, `bash` → `'executing'`, default → `'thinking'`).
- [ ] `SpawnPiAgentResult.sessionId` / `sessionName` are the live `AgentSession` values (falling back to the pre-computed id when the session did not adopt it).
- [ ] A `timeout` rejects with `PiAgentError('Pi agent timed out after Xms', null)` and the session is aborted + disposed.
- [ ] The agent-error fallback body in `webfetchResearch` stays byte-identical (resume hint in `details` / `notify` only).
- [ ] `@earendil-works/pi-coding-agent` is a runtime `dependency`.
- [ ] `npm run validate` is green.
- [ ] No `TODO` / `FIXME` / debug code left behind.

## Implementation Notes

### Tech decisions

- **In-process `AgentSession`, not the SDK's `RpcClient`.** `RpcClient` still spawns a subprocess. The whole point of this refactor is to remove the subprocess. `createAgentSession` runs the agent in-process, which is what gives us programmatic control over tools, keys, and model.
- **Tool allowlist via `createAgentSession({ tools })`.** The SDK's `tools` option sets `allowedToolNames`; `ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"`. Our research allowlist (`read, grep, find, ls, bash`) is a strict subset — exactly the lean tools the prompt references. No `edit`/`write` (the subagent must not mutate the repo).
- **Session identity via `SessionManager`.** To preserve the resume contract (`pi --session <id>`), seed a `SessionManager` with the deterministic `sessionId`:
  ```ts
  const sessionManager = SessionManager.create(cwd, getDefaultSessionDir(cwd));
  sessionManager.newSession({ id: sessionId });
  ```
  Then `createAgentSession({ sessionManager })` yields `session.sessionId === sessionId`. `session.setSessionName(sessionName)` sets the name. The transcript is written to the same `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl` path, so `pi --session <id>` resolves it.
- **Timeout via `session.abort()`.** `prompt()` has no built-in timeout. Wrap the call in a race: `setTimeout(timeoutMs)` → `await session.abort()` (async, waits for idle) → reject with `PiAgentError`. The `finally` disposes the session.
- **Final text from `session.messages`.** After `agent_end`, the last assistant message's `content` (filtered to `type === 'text'`) joined is byte-equal to the concatenation of all `text_delta` events. Use the delta buffer for streaming and the message text for the final `analysis` (defensive: the message is the authoritative source).
- **`getEnvApiKey` from `@earendil-works/pi-ai/compat`.** The SDK's auth resolution falls back to env vars for known providers; the isolated `ModelRuntime` starts empty unless we (a) set a runtime key via `setRuntimeApiKey` or (b) rely on the env fallback. We keep the env fallback as the baseline and layer an explicit key on top.
- **`exitCode` is always `0` on success.** In-process there is no child process exit code. `SpawnPiAgentResult.exitCode` stays `0` (back-compat: `webfetchResearch` doesn't read it today). A failed turn throws `PiAgentError`.
- **`env` option is still honored** by merging into `process.env` scope... actually, the SDK reads `process.env` directly for model keys and settings. To honor `SpawnPiAgentOptions.env`, we apply it to the `ModelRuntime` fallback by setting runtime keys for any env vars the caller passes (best-effort). The `cwd` option drives the `AgentSession`'s working dir.

### Key files

| Path | Change |
|---|---|
| `extensions/pi-session.ts` | NEW: in-process `AgentSession` wrapper (event mapping, timeout, abort, dispose, session seeding). |
| `extensions/pi-agent.ts` | Rewrite `spawnPiAgent` to delegate to `pi-session.ts`. Keep the public API + `buildResearchPrompt` + `DEFAULT_*`. |
| `extensions/model-config.ts` | Add optional `apiKey` to `ResearchModelConfig`; load/save it. |
| `extensions/pi-rpc-client.ts` | DELETED. |
| `extensions/services/research-service.ts` | Unchanged (public `spawnPiAgent` API preserved). |
| `test/helpers/fake-pi-rpc.ts` | DELETED (replaced by a fake `AgentSession` inline in tests). |
| `test/pi-rpc-client.test.ts` | DELETED → replaced by `test/pi-session.test.ts`. |
| `test/pi-agent.test.ts` | Rewrite to mock `createAgentSession` / fake `AgentSession`. |
| `test/webfetch-research.test.ts` | Unchanged (mocks `spawnPiAgent`; contract intact). |
| `test/resume.test.ts` | Unchanged. |
| `package.json` | Pin `@earendil-works/*@0.84.4` as `dependencies` (keep `peerDependencies`). |
| `docs/plans/PI_RPC_NOTES.md` | Superseded note → `PI_SDK_IN_PROCESS.md`. |
| `AGENTS.md`, `README.md`, `CHANGELOG.md` | Update architecture / config / changelog. |

### Risks / Rollback

- **Risk: `AgentSession.prompt()` needs auth pre-configured.** `prompt()` throws `formatNoApiKeyFoundMessage(provider)` if `modelRegistry.hasConfiguredAuth(model)` is false. Mitigation: resolve keys before creating the session; surface a clear `PiAgentError` telling the user which provider env var / config key to set.
- **Risk: in-process session persistence writes to `~/.pi/agent/sessions`.** The SDK's `SessionManager.create(cwd)` writes transcripts to the user's pi session dir — same as today's subprocess. This is the *feature* (resumable sessions), not a leak.
- **Risk: `createAgentSession` loads settings/skills from the user's agent dir.** The default `SettingsManager.create` / `DefaultResourceLoader` read `~/.pi/agent`. Mitigation: pass `SettingsManager.inMemory()` and a minimal resource loader (or rely on defaults where the loaded skills are harmless — the lean prompt doesn't reference them). Decide during implementation; prefer in-memory to avoid surprising reads.
- **Rollback:** `git revert` the refactor commit(s). The public API is unchanged, so `research-service.ts`, CLI, MCP, and the extension tool all keep working on either transport.