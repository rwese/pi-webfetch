# Plan Implementation TODO

Plan: [PLAN_AGENT_ERROR_RESUME.md](./docs/plans/PLAN_AGENT_ERROR_RESUME.md) (Agent-Error Details & Subagent Session Resume)

## Step 1 — `pi-agent` argv for `--name` / `--session-id`

- [x] Add `sessionId?: string` and `sessionName?: string` to `SpawnPiAgentOptions` in `extensions/pi-agent.ts`.
- [x] Add the same fields to `SpawnPiAgentResult`.
- [x] Pass `--session-id <id>` and `--name <name>` to the spawn argv when set; do not add them when unset (back-compat).
- [x] Extend `test/pi-agent.test.ts` with 3 cases: set produces the flags, unset omits them, result carries the fields.
- [x] Verify: `npm test -- --run test/pi-agent.test.ts` green.

## Step 2 — `research-service` threading + new `WebfetchDetails` fields

- [x] Create `extensions/utils/resume.ts` exporting `formatResumeHint`, `deriveSessionName(url)`, `deriveSessionId(now, url, query)` (sha256, 16 hex chars, `hash(timestamp + url + query)`).
- [x] Add `subagentSessionId?`, `subagentSessionName?`, `resumeCommand?` to `WebfetchDetails` in `extensions/types.ts`.
- [x] Add `now?: () => number` and `notify?: (msg: string, level: 'info' | 'warn' | 'error') => void` parameters to `webfetchResearch` (additive, at the end).
- [x] When `webfetchResearch` spawns, derive `(sessionId, sessionName)` from `(now, url, query)` and pass to `spawnPiAgent`.
- [x] In the catch block, build the resume hint via `formatResumeHint`, populate the new `details` fields, and call `notify` exactly once. Do **not** modify the in-content `## Fetch Result (Agent Error)` body.
- [x] Extend `test/webfetch-research.test.ts` with 4 cases: details fields, byte-identical content regression, notify called once with stable format, determinism (same `now` → same id, different `now` → different id).
- [x] Verify: `npm test -- --run test/webfetch-research.test.ts` green.

## Step 3 — Extension surface (tool + slash command)

- [x] `extensions/tools/webfetch.ts` `execute()`: pass `now: () => Date.now()` and a `notify` shim that calls `ctx.ui.notify(msg, 'error')`. Update the existing call-args test from 7 to 8 args.
- [x] `extensions/commands/webfetch-command.ts` handler: same `now` + `notify` shim.
- [x] Manual smoke: from a real pi session, run `/webfetch <url> "<query>"` against a URL where the subagent fails; observe one `ctx.ui.notify(msg, 'error')` with `pi --session <id>` and the subagent session name; the markdown fallback in the agent's context is byte-identical to a pre-change baseline.
- [x] Verify: `npm test -- --run test/cli.test.ts test/mcp-tools.test.ts` (sanity, not the focus of this step).

## Step 4 — CLI surface

- [x] `extensions/cli.ts`: pass `now` and a stderr-printing `notify` shim. Synthesize a per-process session id seed (e.g., embed in the `--session-id` derivation; the existing `hash(timestamp + url + query)` already gives unique-per-invocation ids, no extra synthesis needed).
- [x] On the agent-error path (existing catch in `webfetchResearch`), the notify shim writes one stderr line in the stable format.
- [x] Extend `test/cli.test.ts`: capture stderr in the existing happy-path test; add a new test that exercises the agent-error branch via a mocked `deps.webfetchResearch` returning a fallback with `details.processedAs === 'error'`, asserting one stderr line. Update the existing 7-arg call-args assertion to 8 args.
- [x] Verify: `npm test -- --run test/cli.test.ts` green.

## Step 5 — MCP surface

- [x] `extensions/mcp-tools.ts`: pass `now` and a `_meta.details.notify`-writing shim. The `structuredContent` shape is unchanged (zod stability).
- [x] `extensions/mcp-server.ts`: same; no new env hooks.
- [x] Extend `test/mcp-tools.test.ts`: assert `details.subagentSessionId` / `subagentSessionName` / `resumeCommand` are present in `_meta.details` on the agent-error branch; `isError: true` preserved. Update the existing 7-arg call-args assertion to 8 args.
- [x] Verify: `npm test -- --run test/mcp-tools.test.ts` green.

## Step 6 — Polish

- [ ] `npm run validate` green (typecheck + lint + tests).
- [x] Update `CHANGELOG.md` with an "0.x.y — date" entry under "Added" + "Changed" describing: new `WebfetchDetails` fields, the persistent subagent session, the notify, the resume command, the deterministic unique-per-invocation id.
- [x] Update `README.md`: one short paragraph on the resume flow (`pi --session <id>` from the same cwd, `pi -r` as a picker fallback, CLI/MCP re-run command).
- [x] Update `AGENTS.md`: one-line architecture note update under "Architecture Notes" pointing at the new error-ux flow and the new `WebfetchDetails` fields.
- [ ] `npm run build`.
- [ ] `npm pack --dry-run` and verify `dist/`, `extensions/`, `src/`, `.mcp.json`, `.codex-plugin/`, `README.md`, `LICENSE` are present.
- [x] Small, scoped commits per step (one step per commit, conventional-commits subject).

## Definition of Done

- [x] All step items complete.
- [ ] `npm run validate` green.
- [ ] Manual verification: a real `/webfetch` call that triggers the agent-error path shows a TUI notify with `pi --session <id>` and the session name; the markdown fallback in the agent's context is byte-identical to the pre-change baseline.
- [ ] Manual verification: `pi --session "<id>"` from the same cwd opens the failed subagent's transcript (URL, query, fetched content, partial analysis).
- [ ] Manual verification: `pi-webfetch webfetch <url> --query <query>` from a shell that triggers the agent-error path prints one stderr line; exit code preserved.
- [x] `CHANGELOG.md`, `README.md`, `AGENTS.md`, `BACKLOG.md` (#8 moved to In Progress), and `docs/prds/subagent-sandbox/README.md` (re-scope note) all updated.
- [ ] No `TODO` / `FIXME` / debug code left behind.
