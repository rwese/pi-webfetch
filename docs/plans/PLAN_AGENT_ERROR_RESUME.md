---
state: approved
needed: true
reviewed: 2026-06-05
notes: 'Approved 2026-06-05; implementation not yet started. See ../TODO.md for the active step list.'
---

# Plan: Agent-Error Details & Subagent Session Resume

## Context

<goal syntax="markdown">When `webfetchResearch` falls back to raw fetched content because the spawned `pi` subagent failed, the user gets the message `**Agent Error:** ${errorMessage}` (extensions/services/research-service.ts:204) and nothing else. This is unactionable: the user cannot tell which subagent produced the error, what its full prompt was, or how to re-examine the analysis. Make the failure self-debuggable by (a) making the subagent a real, named, persistent pi session — invocable as `pi -p --name "<n>" --session-id "<id>" "<prompt>"` and resumable with `pi --session "<id>" -p "..."` — and (b) surfacing the resume command in the error path as a TUI notify (not in the agent's context) so the conversation is not polluted.</goal>

The "session" the user resumes is the **subagent** itself. It already contains the URL, the query, and the fetched content in its prompt; resuming it lets the user inspect the failed analysis directly. The parent pi session is incidental — the user doesn't need to "go back" to where they invoked `/webfetch`; they need to "open the lid" on what the subagent did.

This pivots away from the original PRD's `XDG_CACHE_HOME/pi-webfetch/sessions/<id>/<slug>/` workspace, because that workspace was the resume target under the ephemeral-subagent design. With a persistent subagent, the subagent's own session file (`~/.pi/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl`) is the resume target, and the workspace is unnecessary for the error-ux story. The full sandbox PRD stays in scope as a separate security-focused follow-up.

## Scope

### In scope

- New options on `SpawnPiAgentOptions` in `extensions/pi-agent.ts`:
  - `sessionId?: string` — passed through as `--session-id <id>` to the subagent.
  - `sessionName?: string` — passed through as `--name <name>` to the subagent.
  - These are **always added** when research mode spawns the subagent. They are not optional; the failure-ux story depends on the subagent being a real session.
- `webfetchResearch` derives a stable, **unique-per-invocation** subagent session id by hashing the timestamp + URL + query. Re-running the same `/webfetch` call does not continue the prior subagent session — each call is its own session.
- The subagent is spawned as `pi -p --name "<name>" --session-id "<id>" "<prompt>"`. We do **not** set `--no-session`. We do not change `cwd` (inherits the parent's; this is required for `pi --session` to be cwd-resumable).
- New optional fields on `extensions/types.ts::WebfetchDetails`:
  - `subagentSessionId?: string`
  - `subagentSessionName?: string`
  - `resumeCommand?: string` — the precise `pi --session <id> -p "..."` form the user can run.
- New `extensions/utils/resume.ts` helper `formatResumeHint({ sessionId, sessionName, source, url, query, errorMessage })` returning `{ message, command, details }`:
  - Extension path: `command = "pi --session <id>"`. The `message` includes the session name (so the user recognises it in `pi -r`).
  - CLI / MCP path: `command = "pi-webfetch webfetch <url> --query <query>"` (the user re-runs the same webfetch; a brand new subagent session is created and resumable from the new failure). The session id is mentioned in the message for the advanced user.
- Modified `webfetchResearch` catch block: build the resume hint, populate `details`, fire the `notify` callback. **No change to the in-content markdown fallback** — the user explicitly asked for the hint to live outside the agent's context.
- Threading the new options / `notify` shim through:
  - `extensions/services/research-service.ts` — derives `sessionId` / `sessionName` when not provided, threads to `spawnPiAgent`, builds the hint in catch.
  - `extensions/tools/webfetch.ts` — passes `ctx.sessionManager.getSessionId()`-derived subagent id, plus a `notify` callback that calls `ctx.ui.notify(msg, 'error')`.
  - `extensions/commands/webfetch-command.ts` — same, via the command's `ctx`.
  - `extensions/cli.ts` — derives a per-process-stable subagent id seed (e.g., `cli-<pid>`-prefixed), writes the resume hint to stderr on the agent-error path.
  - `extensions/mcp-tools.ts` + `extensions/mcp-server.ts` — mirror the CLI path with `mcp-<pid>` prefix.
- Tests:
  - `test/pi-agent.test.ts` (extended): asserts `--name` and `--session-id` are passed; `sessionId` defaults are derived when omitted; argv is stable for the same (content, query) pair.
  - `test/webfetch-research.test.ts` (extended): when `spawnPiAgent` rejects, `details.subagentSessionId`, `details.subagentSessionName`, `details.resumeCommand` are set; `notify` is called once with a non-empty message; in-content `## Fetch Result (Agent Error)` body is byte-identical to today.
  - `test/cli.test.ts` (extended): synthesized `cli-…` subagent id; stderr line is the resume hint; non-zero exit preserved; existing call-args assertion updated.
  - `test/mcp-tools.test.ts` (extended): synthesized `mcp-…` subagent id; `details.subagentSessionId` / `details.resumeCommand` present; `isError: true` preserved; existing call-args assertion updated.
- Docs:
  - `CHANGELOG.md` entry under "Added" + "Changed".
  - `README.md`: one short paragraph describing the resume flow and the `pi -r` alternative.
  - `AGENTS.md`: one-line architecture note update; link to this plan from "Architecture Notes".

### Out of scope (deferred)

- Sandbox workspace dir (`XDG_CACHE_HOME/pi-webfetch/sessions/<id>/<slug>/`) from `docs/prds/subagent-sandbox/README.md`. The error-ux story does not need it. The full sandbox PRD remains relevant as a **separate** security-focused slice and should be re-scoped: it no longer needs the "keep dir on failure" rule, and its session-id model is independent of the one we use here.
- Process-group spawn, `killProcessTree`, SIGTERM/SIGKILL reap — still covered by the sandbox PRD.
- `extensions/cache.ts` migration to XDG.
- Stale-dir sweep.
- Auto-resume flows; the user runs the command themselves.
- A widget that pins the resume hint in the TUI; we use the standard `ctx.ui.notify`.
- Persisting the subagent's stderr to a log file. The subagent session JSONL contains the full transcript; that's the source of truth.

## Acceptance Criteria

- [ ] When `webfetchResearch` spawns the subagent, the spawned argv contains `--name "<n>"` and `--session-id "<id>"` (in addition to `-p` and the existing skills / tools / extensions).
- [ ] The session id is deterministic given the same `(timestamp, url, query)` triple and changes when any of those change.
- [ ] When `spawnPiAgent` rejects, `result.details` contains `subagentSessionId`, `subagentSessionName`, and `resumeCommand`. The extension path's `resumeCommand` is `pi --session <id>` (resumable from the same cwd).
- [ ] The fallback content (`## Fetch Result (Agent Error) …`) is **byte-identical to today** — the resume hint is **not** added to the content. Only `details` and a side-channel `notify` carry it.
- [ ] In the pi extension, exactly one `ctx.ui.notify(msg, 'error')` call is made from the tool/command error path, with the resume command and the subagent session name in the message.
- [ ] In the CLI, the resume command is `pi-webfetch webfetch <url> --query <query>` (since there's no parent pi session to fall back on); one stderr line is printed in addition to the existing fallback content on stdout. The exit code is unchanged.
- [ ] In the MCP `webfetch` tool, the resume command is mirrored in `_meta.details`; `structuredContent` is unchanged (zod-shape-preserving); `isError: true` is preserved.
- [ ] The same `/webfetch <url> "<query>"` invocation, called twice in a row, produces two distinct subagent sessions (different session ids) — the second does not continue the first. This is the unique-per-invocation contract.
- [ ] Manually verified: `pi --session "<id>"` from the same cwd opens the failed subagent's transcript.
- [ ] `npm run validate` is green (typecheck + lint + tests).
- [ ] No `TODO` / `FIXME` / debug code left behind.

## First Verifiable State

**Order first, not time.**

- [ ] First task: extend `extensions/pi-agent.ts` to accept and pass `sessionId` and `sessionName` as `--session-id` / `--name` argv. Extend `test/pi-agent.test.ts` to assert those flags land in the argv. Verify: `npm test -- --run test/pi-agent.test.ts` green. **This is the smallest end-to-end proof: a subagent spawned by webfetch is now a real, named session, and the existing test surface validates the argv.**
- [ ] Second task: extend `webfetchResearch` to derive `(sessionId, sessionName)` and pass them to `spawnPiAgent`. Add the three new `WebfetchDetails` fields. Build the resume hint in the catch block. Extend `test/webfetch-research.test.ts` to assert the new fields and the byte-identical fallback content. Verify: `npm test -- --run test/webfetch-research.test.ts` green.

Once those two green, the rest of the plan is mechanical: surface wiring (extension, CLI, MCP) and the notify callback.

## Implementation Notes

### Tech decisions

- **The subagent is the resume target**, not the parent. The parent pi session is incidental. We surface the subagent's session id and the `pi --session <id>` command.
- **`--name` and `--session-id` are always added** when webfetchResearch spawns the subagent. They are not behind a flag. The failure-ux story is core.
- **Unique-per-invocation session id** = `hash(timestamp + url + query)`. The hash function is `sha256` truncated to a stable length (e.g., 16 hex chars); the timestamp is ISO-8601 UTC at second precision, captured before the spawn. We use the first 8 chars as the visible id (matching pi's "short UUID" display) and the full 16 hex chars as the file-system identifier.
- **The session name is human-readable**: `webfetch-research: <host>` (e.g., `webfetch-research: example.com`). If the URL has no host, fall back to the first 40 chars of the URL. Names are short, recognisable in `pi -r`, and not unique — that's fine, pi handles name collisions in the picker.
- **No `cwd` change** for the subagent. The subagent inherits the parent's cwd. This is required for `pi --session <id>` to be cwd-resumable. The sandbox PRD's "subagent runs in a sandboxed dir" goal is **explicitly deferred** — it's a security concern, not an error-ux one, and the failure-ux works without it.
- **No automatic cleanup of subagent sessions.** The subagent session is a feature, not a leak. The user can `/resume` and pick it up later. Disk usage is bounded (~5–50 KB per research call, even at 1000 calls/day that's 50 MB).
- **`ctx.ui.notify`** is preferred over `ctx.ui.setStatus` because the status slot is short and the resume hint has multiple lines. The notify is single-shot and disappears on next user input, matching the "ephemeral debug aid" intent.
- **CLI / MCP synthesized ids** are scoped to the running process, with a per-process prefix (`cli-<pid>` / `mcp-<pid>`). The session id itself is still `hash(timestamp + url + query)`. The CLI/MCP `resumeCommand` is the original `pi-webfetch webfetch …` invocation echoed back, not `pi --session <id>` — because CLI/MCP users don't have a parent pi session and the actionable thing is "re-run with the same query".
- **The notify message format is stable** so users can grep / script it:
  - Extension: `Research subagent failed.\nResume: pi --session <id>\nSession name: <name>\nReason: <errorMessage>`.
  - CLI: `Research subagent failed.\nSubagent session: <id>\nRe-run: pi-webfetch webfetch <url> --query <query>\nReason: <errorMessage>`.
  - MCP: same as CLI, returned in `_meta.details.notify`.
- **One notify per failure.** Idempotency is enforced by `webfetchResearch` itself: the catch block fires exactly once per call.
- **Determinism for tests.** `webfetchResearch` accepts a `now: () => number` injection (default `Date.now`) so the test suite can fix the timestamp and assert on a known id. The hash function is pure, so this is enough for stable assertions.

### Key files

| Path | Change |
|---|---|
| `extensions/pi-agent.ts` | Add `sessionId` / `sessionName` to `SpawnPiAgentOptions`; add `sessionId` / `sessionName` to `SpawnPiAgentResult`; pass `--session-id` and `--name` to the spawn argv. |
| `extensions/utils/resume.ts` | NEW: `formatResumeHint(input) → { message, command, details }` and `deriveSessionName(url)` and `deriveSessionId(now, url, query)`. |
| `extensions/utils/index.ts` | re-export. |
| `extensions/services/research-service.ts` | Add additive `now` parameter (default `Date.now`) and `notify` parameter; derive `(sessionId, sessionName)`; thread to `spawnPiAgent`; build the resume hint in catch; populate new `details` fields. |
| `extensions/types.ts` | Add `subagentSessionId?`, `subagentSessionName?`, `resumeCommand?` on `WebfetchDetails`. |
| `extensions/tools/webfetch.ts` | In `execute`, pass `now: () => Date.now()` and a `notify` callback that calls `ctx.ui.notify(msg, 'error')`. |
| `extensions/commands/webfetch-command.ts` | In the handler, same as tool. |
| `extensions/cli.ts` | Pass `now` and a stderr-printing notify shim. Synthesize a per-process session id seed (e.g., embed in the `--session-id`). Update the call-args assertion. |
| `extensions/mcp-tools.ts` | Same. Mirror the resume hint into `_meta.details`. |
| `extensions/mcp-server.ts` | Same. |
| `test/pi-agent.test.ts` | EXTENDED. |
| `test/webfetch-research.test.ts` | EXTENDED. |
| `test/cli.test.ts` | EXTENDED. |
| `test/mcp-tools.test.ts` | EXTENDED. |
| `CHANGELOG.md` | NEW entry. |
| `README.md` | NEW paragraph. |
| `AGENTS.md` | one-line update + link to this plan. |

### Tests needed

- `test/pi-agent.test.ts` — three new cases:
  1. `spawnPiAgent` called with `sessionId: "abc"` and `sessionName: "webfetch-research: example.com"` produces argv containing `--session-id abc --name "webfetch-research: example.com"`.
  2. `spawnPiAgent` called without `sessionId` / `sessionName` does **not** add the flags (back-compat).
  3. `SpawnPiAgentResult` includes `sessionId` and `sessionName` when provided.
- `test/webfetch-research.test.ts` — four new cases:
  1. When the mocked `spawn` rejects, the returned `details` includes `subagentSessionId`, `subagentSessionName`, `resumeCommand`.
  2. The in-content `## Fetch Result (Agent Error)` body is **byte-identical** to a fixed string captured before the change (regression guard).
  3. `notify` is called exactly once with a non-empty string matching the stable format above.
  4. Two consecutive calls with the same `now` produce the same id; two calls with different `now` produce different ids.
- `test/cli.test.ts` — extends the existing `webfetch` happy-path test to capture stderr; adds a new test that exercises the agent-error branch via a mocked `deps.webfetchResearch` returning a fallback with `details.processedAs === 'error'`, asserting one stderr line with the synthesized id and the resume command. The existing 7-arg call-args assertion is updated to pass the new `now` and `notify` shim (8 args).
- `test/mcp-tools.test.ts` — extends the assertion set on `_meta.details` to include the new fields. Verifies `isError: true` is preserved. The existing 7-arg call-args assertion is updated to 8 args.

### Risks / Rollback

- **Risk:** the subagent session id collisions across research calls. **Mitigation:** the id is `hash(timestamp + url + query)`; the timestamp is per-call and the hash is 16 hex chars. Collision probability is negligible.
- **Risk:** the subagent session accumulates in `~/.pi/agent/sessions/...` and is never cleaned up. **Mitigation:** documented as a feature (the user has a history of research sessions). Disk usage is bounded. The user can `rm -rf` the session dir if they want.
- **Risk:** `--session-id` is cwd-scoped, so the resume command fails when the user is in a different cwd. **Mitigation:** the notify message includes `pi -r` (interactive picker) as an alternative. The CLI/MCP `resumeCommand` does not depend on cwd (it's the original `pi-webfetch` invocation).
- **Risk:** the in-content fallback changes accidentally because we tweak the catch block. **Mitigation:** `test/webfetch-research.test.ts` adds a byte-equality assertion against the current `## Fetch Result (Agent Error) …` body. If we change it, the test fails before merge.
- **Risk:** `pi --session <id>` doesn't recognise the id format we generate. **Mitigation:** we use a 16-hex-char id (8 visible chars), which is a valid partial session id per the pi docs ("Use specific session file or partial UUID"). Verified manually with a 13-char id (`test-abc123`); 16 hex chars is also valid.
- **Risk:** adding optional positional params to `webfetchResearch` shifts the existing call sites. **Mitigation:** new params are added at the end of the signature. We update every call site in the same change.
- **Rollback:** the changes are additive and the subagent args are easy to remove. Reverting the new flags, the new `WebfetchDetails` fields, and the catch-block hint restores prior behavior. Old subagent sessions in `~/.pi/agent/sessions/` are inert (just JSONL files the user can `rm`).

## Incremental Plan

1. **[Verification: pi-agent flags]** — extend `extensions/pi-agent.ts` to accept and pass `sessionId` and `sessionName` as `--session-id` / `--name` argv. Extend `test/pi-agent.test.ts`. Verify: `npm test -- --run test/pi-agent.test.ts` green. **No other change; subagent sessions now persist when called from research mode.**
2. **[Core: research-service threading + new fields]** — extend `webfetchResearch` to derive `(sessionId, sessionName)`, add the three new `WebfetchDetails` fields, build the resume hint in the catch block. Extend `test/webfetch-research.test.ts`. Verify: `npm test -- --run test/webfetch-research.test.ts` green.
3. **[Surface: extension]** — `extensions/tools/webfetch.ts` and `extensions/commands/webfetch-command.ts` pass a `notify` shim that calls `ctx.ui.notify(msg, 'error')`. Verify with manual smoke from a real pi session: a `/webfetch … "query"` call that fails shows one notify with the resume command.
4. **[Surface: CLI]** — `extensions/cli.ts` writes the resume hint to stderr on the agent-error path. Extend `test/cli.test.ts`. Verify: `npm test -- --run test/cli.test.ts` green.
5. **[Surface: MCP]** — `extensions/mcp-tools.ts` mirrors the resume hint into `_meta.details`. Extend `test/mcp-tools.test.ts`. Verify: `npm test -- --run test/mcp-tools.test.ts` green.
6. **[Polish]** — `npm run validate`; update `CHANGELOG.md`, `README.md`, and `AGENTS.md`; `npm run build`; `npm pack --dry-run`; commit per step (small, scoped commits per the existing convention).

## Definition of Done

- [ ] Steps 1–6 are merged with `npm run validate` green at each step.
- [ ] A real `/webfetch` call from a pi session that triggers the agent-error path shows a TUI notify with `pi --session <id>` and the subagent session name; the fallback content in the agent's context is byte-identical to today.
- [ ] Manually verified: `pi --session <id>` from the same cwd opens the failed subagent's transcript (the URL, the query, the fetched content, and the partial analysis are all there).
- [ ] A real `pi-webfetch webfetch <url> --query <query>` from a shell that triggers the agent-error path prints one stderr line with the synthesized id, the re-run command, and the error reason; the exit code is preserved.
- [ ] `CHANGELOG.md` has a "0.x.y — date" entry under "Added" + "Changed" describing the new fields, the persistent subagent session, the notify, and the resume command.
- [ ] `BACKLOG.md` "Better error messages" item (#8) gets a one-line update linking to this plan and noting the sandbox PRD is re-scoped.
- [ ] The sandbox PRD (`docs/prds/subagent-sandbox/README.md`) is annotated: "the resume-ux story no longer depends on this PRD's workspace dir; this PRD is now a security-focused sandbox slice, not an error-ux slice."
- [ ] No `TODO` / `FIXME` / debug code left behind.
