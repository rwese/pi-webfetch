# PRD: Subagent Sandbox & Workspace Lifecycle

**Version:** 1.0.0-draft
**Date:** 2026-06-04
**Status:** Planning (re-scoped 2026-06-05; see note below)
**Target:** `@rwese/pi-webfetch` research-mode subagent spawning

> **Re-scope note (2026-06-05):** the original motivation for the workspace
> dir was to give the error-ux flow (`docs/plans/PLAN_AGENT_ERROR_RESUME.md`)
> a place to point the user at. That plan has since been re-shaped to make
> the spawned `pi` itself a real, named, persistent session via
> `pi -p --name "<n>" --session-id "<id>" "<prompt>"`, so the **subagent's
> own session file** (under `~/.pi/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl`)
> is the resume target. This PRD's `XDG_CACHE_HOME/pi-webfetch/sessions/...`
> workspace is no longer required for the error-ux story and is **re-scoped
> to a security-focused sandbox slice**: cwd isolation, process-group
> cleanup, stale-dir sweep. The "keep dir on terminal failure" cleanup rule
> is removed; subagent sessions are kept on disk and managed by the user
> (via `pi -r`) and by pi's own session lifecycle.

---

## 1. Executive Summary

### Problem Statement

The `webfetchResearch` flow in `@rwese/pi-webfetch` spawns a `pi` subprocess to analyze
fetched content. Today the subprocess:

- Inherits `process.cwd()` of the parent (usually the user's project dir). The spawned
  `pi` can read, write, and execute against the user's working tree via its
  `read`/`grep`/`find`/`ls`/`bash` tool allowlist. There is no sandbox.
- Has no per-invocation scratch directory. Any temp files the subagent creates land
  in the parent's cwd and accumulate.
- Has no session grouping. Concurrent invocations from different pi sessions collide
  on the same working dir; debug artifacts cannot be attributed.
- Has no cleanup. Subagent processes, their children, and any files they create survive
  the parent process exit, the parent pi session shutdown, and `npx` wrapper teardown.
- Kills the subagent on timeout with `proc.kill('SIGTERM')` only, not the process
  group. Children of the subagent leak.

#### Related code in this repo

| Path | Purpose | Status |
|---|---|---|
| `extensions/pi-agent.ts` | `spawnPiAgent(content, query, options)`; `node:child_process.spawn('pi', …)` | Active, no sandbox |
| `extensions/services/research-service.ts` | `webfetchResearch()`; calls `spawnPiAgent` | Active, no `cwd`/session passed |
| `extensions/tools/webfetch.ts` | `registerWebfetchTool(pi)`; entry from `pi` tool call | Active, no ctx threading |
| `extensions/commands/webfetch-command.ts` | `/webfetch` slash command | Active, no ctx threading |
| `extensions/cli.ts` | Direct CLI: `npx @rwese/pi-webfetch webfetch …` | Active, no exit handler |
| `extensions/mcp-server.ts` | Stdio MCP server (`@rwese/pi-webfetch mcp`) | Active, no exit handler |
| `extensions/index.ts` | `pi.on('session_shutdown', …)` hook | Active, reaps providers only |
| `src/utils/process.ts` | `killProcessTree`, `ProcessMutex`, `execAsync*` | Exists, not wired into pi-agent |
| `extensions/cache.ts` | URL-content cache, `os.tmpdir()/pi-webfetch-cache/` | Adjacent, out of scope for v1 |
| `extensions/services/session-manager.ts` | Per-process `Symbol('session')` provider map | Adjacent, not aligned with real sessionId |

### Proposed Solution

Introduce a session-scoped workspace under `XDG_CACHE_HOME/pi-webfetch/sessions/<id>/`
with a clean per-invocation subdir, and wire all `pi` subprocess lifecycles to it.
On invocation success or terminal failure, remove the subdir. On parent process exit
or session shutdown, reap any surviving subprocesses and remove the session dir.
SIGKILL is acknowledged as out of scope; a startup stale-dir sweep covers it.

The subagent's `cwd` becomes the invocation dir. Prompt remains inlined into `-p`
for v1 (no file-based content delivery yet). Process tree is killed via a new
process-group spawn config and `killProcessTree`.

---

## 2. Goals & Non-Goals

### Goals

1. **Sandbox the subagent.** Spawned `pi` operates in a fresh, empty, `0o700` directory
   that the user did not choose and that contains no project files.
2. **Group by session.** All invocations from one pi session share a session dir;
   each invocation gets its own subdir.
3. **Auto-cleanup on completion.** Invocation dir is removed when the subagent closes
   (exit code 0, non-zero, or timeout).
4. **Auto-cleanup on parent death.** The session dir is removed when the parent
   pi session shuts down, when the CLI exits, or when the MCP server closes —
   via `process.on('exit' | 'SIGINT' | 'SIGTERM' | 'SIGHUP')` handlers and the
   `session_shutdown` extension event.
5. **Reap child processes.** The subagent's own children die with it via
   process-group signaling, not just SIGTERM to the immediate `proc`.
6. **No new external dependencies.** Use `node:fs/promises`, `node:os`, `node:path`,
   `node:child_process` only.
7. **Test the lifecycle.** Vitest covers dir creation, invocation cleanup,
   stale-dir sweep, and SIGTERM reaping.
8. **Backwards compatible API surface.** Existing `spawnPiAgent` and
   `webfetchResearch` callers keep working; new options are additive.

### Non-Goals

1. **No cache migration in v1.** `extensions/cache.ts` keeps using
   `os.tmpdir()/pi-webfetch-cache/`. Migration is a follow-up.
2. **No postmortem or `--keep` flag.** We do not preserve invocation dirs for
   debugging in v1. Stale sweep is the only artifact path.
3. **No SIGKILL handling.** Accepted leak. Stale sweep on next start is the
   backstop.
4. **No file-based content delivery.** The fetched content is still inlined into
   the `-p` argument, not written to a file. Tracked as a follow-up if argv size
   becomes a problem.
5. **No remote/temporary session store.** All session state is local on disk
   under XDG.
6. **No Windows-specific permission handling.** `0o700` is applied on POSIX only;
   Windows users get the platform default.
7. **No structured per-prompt log.** Stale sweep output and stderr capture are
   the only forensics.

---

## 3. Technical Architecture

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Dir resolution | `node:os` (`homedir`, `tmpdir`) + `process.env.XDG_CACHE_HOME` | Zero new deps; matches `cache.ts` precedent |
| Dir I/O | `node:fs/promises` (`mkdir`, `rm`, `readdir`, `stat`) | Already used in `cache.ts` |
| Process management | `node:child_process.spawn` (existing) + `process.kill(-pid, 'SIGTERM')` (existing helper) | Avoids `pidtree`/`tree-kill` deps |
| Path joining | `node:path` (`join`, `resolve`) | Standard |
| Test isolation | `vitest`, env override of `XDG_CACHE_HOME` | Already in use |
| Session ID source (extension path) | `pi-coding-agent` `ExtensionContext.sessionManager.sessionId` | Real, stable string per session |
| Session ID source (CLI / MCP) | Locally generated `cli-<pid>-<uuid8>` / `mcp-<pid>-<uuid8>` | No upstream session available |

### Project Structure

```text
src/utils/
  workspace.ts          # NEW: XDG root, session dir, invocation dir, prune, cleanup registry
extensions/
  pi-agent.ts           # CHANGED: sessionId/slug options, detached spawn, killProcessTree
  index.ts              # CHANGED: hook session_start to capture sessionId; session_shutdown to reap
  tools/webfetch.ts     # CHANGED: pass ctx.sessionId to webfetchResearch
  commands/webfetch-command.ts  # CHANGED: pass ctx.sessionId to webfetchResearch
  cli.ts                # CHANGED: install exit handlers, generate cli sessionId
  mcp-server.ts         # CHANGED: install exit handlers, generate mcp sessionId
  services/
    research-service.ts # CHANGED: thread sessionId/slug to spawnPiAgent
test/
  workspace.test.ts     # NEW
  pi-agent.test.ts      # EXTENDED: cwd == invocation dir; env has PI_SESSION_DIR; cleanup on close
  cli.test.ts           # EXTENDED: cleanup on exit, no leak on SIGTERM
  mcp-tools.test.ts     # EXTENDED: cleanup on server close
  session-cleanup.test.ts  # NEW: SIGTERM reaps dir; stale sweep
```

### Configuration

No new config file. The relevant inputs:

| Source | Default | Override |
|---|---|---|
| `process.env.XDG_CACHE_HOME` | `~/.cache` (linux) / `~/Library/Caches` (darwin) / `%LOCALAPPDATA%` (win32) | `XDG_CACHE_HOME` env var |
| `process.env.PI_WEBFETCH_KEEP_WORKSPACE` | unset (cleanup) | `1` to disable per-invocation cleanup (debug only, not advertised) |
| `process.env.PI_WEBFETCH_STALE_SWEEP_MAX_AGE_MS` | `86400000` (24h) | ms |
| `process.env.PI_WEBFETCH_DISABLE_STALE_SWEEP` | unset (run sweep) | `1` to skip on startup |

### Layout on disk

```text
$XDG_CACHE_HOME/pi-webfetch/
├── sessions/
│   ├── <sessionId-1>/
│   │   ├── <invocationSlug-1>/      # cleaned up on completion
│   │   ├── <invocationSlug-2>/      # cleaned up on completion
│   │   └── .pid                      # newline list of live child PIDs (best-effort)
│   └── <sessionId-2>/
│       └── …
└── .lastsweep                        # mtime for sweep throttling
```

`<invocationSlug>` shape (v1):

```text
<ISO8601-UTC-compact>-<6-char-base32-random>
# e.g. 20260604T093015Z-7K2P9X
```

No prompt text, no URL, no PII. Live logs in the parent process correlate by
timestamp.

---

## 4. Interface Specification

### Public API

`src/utils/workspace.ts` (new module):

```ts
export function getXdgCacheHome(): string;
export function getWorkspaceRoot(): string;          // <xdg>/pi-webfetch
export function getSessionDir(sessionId: string): string;
export interface InvocationHandle {
  dir: string;                  // absolute path, exists, 0o700 on POSIX
  sessionId: string;
  slug: string;
  cleanup(): Promise<void>;     // idempotent, swallows ENOENT
}
export async function createInvocation(
  sessionId: string,
  options?: { slug?: string }
): Promise<InvocationHandle>;
export async function removeSession(sessionId: string): Promise<void>;
export async function pruneStaleSessions(opts?: { maxAgeMs?: number }): Promise<{
  removed: string[];
  errors: string[];
}>;
export function registerWorkspaceCleanup(opts: {
  sessionId: string;
  getLiveChildPids: () => Iterable<number>;
}): () => void;  // returns unregister fn
```

`extensions/pi-agent.ts` (changed):

```ts
export interface SpawnPiAgentOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  onChunk?: (chunk: string) => void;
  skills?: string[];
  extensions?: string[];
  noExtensions?: boolean;
  // NEW
  sessionId?: string;        // auto-derived if absent
  invocationSlug?: string;   // auto-derived if absent
  keepWorkspace?: boolean;   // default false; respects env PI_WEBFETCH_KEEP_WORKSPACE
}

export interface SpawnPiAgentResult {
  analysis: string;
  exitCode: number;
  workspaceDir: string;      // NEW: absolute path of the invocation dir (post-spawn)
}
```

### Behavior changes

| Aspect | Before | After |
|---|---|---|
| `cwd` of spawned `pi` | `process.cwd()` | invocation dir under XDG |
| `detached` | unset (false) | `true` (new process group) |
| Timeout cleanup | `proc.kill('SIGTERM')` | `killProcessTree(proc)` → process group SIGTERM |
| `process.on('exit' | SIGINT | SIGTERM | SIGHUP')` | none | registered once, idempotent; reaps all live PIDs and removes session dir |
| Stale sweep on startup | none | runs if `.lastsweep` mtime > 1h, capped by `PI_WEBFETCH_STALE_SWEEP_MAX_AGE_MS` |
| Permissions on session dir | n/a | `0o700` on POSIX; best-effort on Windows |

### CLI behavior

```bash
# Unchanged usage
pi-webfetch webfetch https://example.com --query "summarize this"
# Internally: creates <xdg>/pi-webfetch/sessions/cli-<pid>-<uuid8>/<slug>/
# On exit (any way): removes session dir; removes tmp file if spawned pi wrote one.
```

### MCP server behavior

```bash
# Long-running
npx -y @rwese/pi-webfetch mcp
# Creates <xdg>/pi-webfetch/sessions/mcp-<pid>-<uuid8>/<slug-N>/ per call
# On SIGTERM / server close: kill all tracked PIDs, remove session dir
```

### Extension behavior

```text
pi session "abc123" runs /webfetch https://example.com "summarize"
  → tool handler receives ctx.sessionManager.sessionId === "abc123"
  → webfetchResearch(sessionId="abc123", …)
  → spawnPiAgent(…, { sessionId: "abc123" })
    → creates <xdg>/pi-webfetch/sessions/abc123/20260604T093015Z-7K2P9X/
    → spawns pi in that dir, detached
  → pi returns
  → cleanup fn removes the invocation dir
  → session "abc123" stays on disk for follow-up invocations

later: /webfetch https://other.example "another query"
  → reuses <xdg>/pi-webfetch/sessions/abc123/20260604T094500Z-3QH7LM/

later: user quits pi
  → pi.on('session_shutdown') fires
  → registerWorkspaceCleanup reaps any still-live PIDs, removes <xdg>/.../abc123/
```

---

## 5. Feature Roadmap

### Phase 1 — Workspace primitive

- [ ] Implement `src/utils/workspace.ts`: XDG resolution, dir creation with `0o700`,
      invocation handle with idempotent cleanup, session-dir removal, stale sweep.
- [ ] Implement `registerWorkspaceCleanup` with `process.on('exit' | 'SIGINT' | 'SIGTERM' | 'SIGHUP')`,
      guarded by a process-scoped "installed" flag and a test-disarm hook.
- [ ] `test/workspace.test.ts`: XDG fallback paths per platform; dir creation;
      cleanup is idempotent; pruneStaleSessions removes only dirs older than maxAge.

### Phase 2 — pi-agent refactor

- [ ] Refactor `extensions/pi-agent.ts`:
      - Accept `sessionId` and `invocationSlug` options; auto-derive if absent.
      - Create invocation dir before spawn; set `cwd` to it; `detached: true`.
      - Pass `PI_SESSION_DIR` and `PI_INVOCATION_DIR` in child env.
      - On `close` (any code) and on `error`: call `handle.cleanup()` unless
        `keepWorkspace` is true.
      - On timeout: call `killProcessTree(proc)` from `src/utils/process.ts`.
      - Track child PIDs in a `Set<number>` returned to the cleanup registrar.
- [ ] Extend `test/pi-agent.test.ts` with: cwd assertion, env assertion, cleanup
      invocation on success, cleanup invocation on non-zero exit, cleanup invocation
      on timeout, process-group kill.

### Phase 3 — Entry-point wiring

- [ ] Extension: in `extensions/index.ts`, capture sessionId in `on('session_start')`
      via `ctx.sessionManager.getSessionId()`; in `on('session_shutdown')`, unregister
      cleanup and remove the session dir.
- [ ] Tool: `extensions/tools/webfetch.ts` passes `ctx.sessionId` to `webfetchResearch`.
- [ ] Command: `extensions/commands/webfetch-command.ts` does the same.
- [ ] CLI: `extensions/cli.ts` generates `cli-<pid>-<uuid8>` and registers
      `registerWorkspaceCleanup` once per process.
- [ ] MCP: `extensions/mcp-server.ts` generates `mcp-<pid>-<uuid8>`, registers
      `registerWorkspaceCleanup`, and runs cleanup in `server.close()` and
      `transport.close()` paths.
- [ ] `extensions/services/research-service.ts` threads `sessionId` and `invocationSlug`
      to `spawnPiAgent`.

### Phase 4 — Tests

- [ ] `test/workspace.test.ts` (new).
- [ ] `test/pi-agent.test.ts` (extended).
- [ ] `test/cli.test.ts` (extended): cleanup after a successful run; cleanup after
      a simulated SIGTERM.
- [ ] `test/mcp-tools.test.ts` (extended): server close cleans its session dir.
- [ ] `test/session-cleanup.test.ts` (new): long-running `spawnPiAgent` in a child
      Node process; parent sends SIGTERM; asserts invocation dir is gone and
      child PIDs are reaped; asserts SIGKILL leaves the dir and a follow-up
      `pruneStaleSessions` removes it.

### Phase 5 — Docs & migration prep

- [ ] Update `AGENTS.md`: drop the `cwd: process.cwd()` line; add a "Workspace"
      section with the layout and lifecycle diagram.
- [ ] Update `BACKLOG.md` item #4 (Resource Cleanup & Concurrency): mark this
      PRD as the resolution; link to this file.
- [ ] `README.md`: one paragraph on `XDG_CACHE_HOME` and where scratch lives.
- [ ] Do **not** migrate `extensions/cache.ts` in v1; open a follow-up PRD.

**Milestone (MVP):** Phase 1 + Phase 2 + Phase 3 are merged. `npm run validate`
green. Manual smoke: run `/webfetch` from pi extension, observe
`$XDG_CACHE_HOME/pi-webfetch/sessions/<id>/` exist transiently and disappear
within a second of the response. Quit pi mid-research; observe dir gone.

---

## 6. Integration Notes

### Comparison

| Aspect | Current | New |
|---|---|---|
| Subagent `cwd` | `process.cwd()` (user project dir) | `<xdg>/pi-webfetch/sessions/<id>/<slug>/` |
| Per-invocation scratch | none | clean dir, `0o700` |
| Session grouping | none (inherited cwd shared across sessions) | explicit `<sessionId>/` |
| Subagent cleanup | none | on `close`, `error`, timeout |
| Parent cleanup | none | on `exit`, `SIGINT`, `SIGTERM`, `SIGHUP`, `session_shutdown` |
| Process tree kill | `proc.kill('SIGTERM')` to direct child | `killProcessTree(proc)` (process group) |
| Stale-dir recovery | none | startup sweep, throttled to 1h |
| Existing test coverage | `test/pi-agent.test.ts` checks args, skills, tools, timeout | adds cwd/env/cleanup assertions |
| External deps | none | none |

### Migration path

1. Ship `src/utils/workspace.ts` and the refactored `extensions/pi-agent.ts` in
   one minor version bump. Existing callers keep working because new options
   are additive and default-derived.
2. Wire entry points in the same release (Phase 3). No CLI flag flip — behavior
   change is silent because the new sandbox dir is equivalent to or stricter
   than the old `process.cwd()` for the subagent's purposes.
3. Document in `CHANGELOG.md` under "Changed" that the subagent now runs in a
   sandboxed dir under `XDG_CACHE_HOME`.

### Backwards compatibility

- `spawnPiAgent` signature is widened (additive). All existing call sites compile.
- `webfetchResearch` signature is widened (additive `sessionId` / `invocationSlug`).
- The visible behavior to the user is identical: same streaming, same fallback on
  agent error, same `processedAs: 'research'`.
- One observable difference: `cwd` of the subagent is no longer the user's project
  dir. If any user-recipe depends on the subagent having access to project files
  (e.g., "analyze this URL and compare to the local `src/` tree"), it will break.
  We accept this; it was an undocumented assumption. Document in CHANGELOG.

---

## 7. Open Questions

1. **XDG fallback on macOS.** Spec-correct XDG fallback on darwin is
   `~/.cache`. macOS-native is `~/Library/Caches/<bundle-id>`. We do not have
   a bundle id. Pick `~/.cache/pi-webfetch` for cross-platform consistency,
   or `~/Library/Caches/pi-webfetch` for macOS-native?
2. **Slug contents.** v1 plan: timestamp + 6-char base32 random. Should the
   first 4 chars of a SHA256 of `(url | prompt)` be appended for human
   correlation? Risk: leaks prompt content into filenames. Lean: no.
3. **Keep flag discoverability.** Should `PI_WEBFETCH_KEEP_WORKSPACE=1` be
   documented in README or kept internal? Lean: internal-only, mention in
   AGENTS.md for debugging.
4. **Concurrent invocations per session.** Two `/webfetch` calls fired in the
   same tick from the same session will both try to create the same slug
   (collision probability 1 in ~10^9 with 31 bits). Do we want an
   `O_EXCL`-style retry, or trust the random suffix? Lean: trust it; a
   collision is a one-off test failure, not a security issue.
5. **Stale sweep location.** Run from a one-shot `setImmediate` on module load,
   or lazy on first `createInvocation`? Lean: module load, but only in CLI
   and MCP processes (not the extension, where pi already manages lifecycle).
6. **Session ID for CLI without a TTY.** Piped `npx @rwese/pi-webfetch webfetch …`
   has no parent session. We synthesize `cli-<pid>-<uuid8>`. Acceptable as
   one-shot, but if a wrapper script calls webfetch in a loop we accumulate
   many short-lived session dirs. Should we have a CLI flag
   `--session-id <id>` to reuse a dir across calls? Lean: not in v1.
7. **Permissions on Windows.** `0o700` is a no-op there. Do we add an
   `icacls` call, or document the caveat? Lean: document only.

---

## 8. Success Criteria

- [ ] `npm run validate` is green (typecheck + lint + tests) on the merged PR.
- [ ] `test/workspace.test.ts` covers: XDG fallback, dir creation, idempotent
      cleanup, stale sweep, permissions on POSIX.
- [ ] `test/pi-agent.test.ts` covers: `cwd === invocationDir`, env vars
      `PI_SESSION_DIR` / `PI_INVOCATION_DIR` present, cleanup on success / error /
      timeout, process-group kill verified by spawning a `pi`-like child that
      itself spawns a grandchild.
- [ ] `test/session-cleanup.test.ts` covers: SIGTERM during a long spawn reaps
      the dir; SIGKILL leaves the dir and a follow-up `pruneStaleSessions`
      removes it.
- [ ] Manual smoke: a `/webfetch` call from a real pi session shows
      `<xdg>/pi-webfetch/sessions/<id>/<slug>/` exist transiently during the
      call and disappear within 1 s of the response.
- [ ] Manual smoke: starting a long `/webfetch` (e.g., 60 s timeout), then
      sending SIGTERM to the parent pi process, leaves no orphan `node` /
      `pi` processes (`pgrep -f pi`).
- [ ] `AGENTS.md` updated; `BACKLOG.md` item #4 marked resolved.
- [ ] `CHANGELOG.md` entry under "Changed" describing the sandbox move.

---

## 9. Repository Location

- Code: under existing paths (`src/utils/workspace.ts`, `extensions/pi-agent.ts`,
  `extensions/{index,cli,mcp-server,services/research-service}.ts`,
  `extensions/{tools,commands}/webfetch*.ts`).
- Tests: under `test/`.
- PRD: this file, `docs/prds/subagent-sandbox/README.md`.

---

## Appendix A: Example session trace

```text
$ XDG_CACHE_HOME=/tmp/xdg pi-webfetch webfetch https://example.com --query "summarize"

# Process tree while running:
node pi-webfetch (pid 1000, sessionId = cli-1000-a1b2c3d4)
  └─ node /usr/local/lib/node_modules/pi/bin/pi.js -p '...' --tools read,grep,... (pid 1001, detached, pgid 1001)
       └─ /bin/sh -c 'agent-browser …' (pid 1002)
            └─ chromium ... (pid 1003)

# Disk during run:
/tmp/xdg/pi-webfetch/sessions/cli-1000-a1b2c3d4/
  20260604T093015Z-7K2P9X/        # invocation dir, cwd of pi
  .pid                             # "1001\n1002\n1003\n"

# pi returns 0, stdout = "Example Domain is a reserved ..."

# Within 1 s:
/tmp/xdg/pi-webfetch/sessions/cli-1000-a1b2c3d4/   # still exists
# invocation dir 20260604T093015Z-7K2P9X/ removed

# CLI exits 0, process.on('exit') fires:
/tmp/xdg/pi-webfetch/sessions/                    # empty
/tmp/xdg/pi-webfetch/.lastsweep                    # updated
```

```text
# Failure case: pi is hung, parent times out

$ pi-webfetch webfetch https://slow.example.com --query "..."

# t = 60 s: timeout fires
#   → killProcessTree(1001) → process.kill(-1001, 'SIGTERM')
#   → kernels delivers SIGTERM to 1001, 1002, 1003
#   → children die, stderr "Terminated: 15" collected
#   → InvocationHandle.cleanup() → rm -rf invocation dir
#   → webfetchResearch catch block: returns raw fetched content
#     with processedAs: 'error', phase: 'error'
#   → process.on('exit') removes session dir
```

```text
# SIGKILL case (out of scope, stale sweep covers it)

$ kill -9 $(pgrep -f "pi-webfetch")
# Invocation dir 20260604T093015Z-7K2P9X/ survives
# Session dir cli-1000-a1b2c3d4/ survives

# Next day, user runs:
$ pi-webfetch webfetch https://other.example
# On startup, pruneStaleSessions() runs (throttled to 1h)
#   → cli-1000-a1b2c3d4/ is 24h old → removed
#   → .lastsweep updated
```

---

## Appendix B: Process-group kill evidence

The current `killProcessTree` helper in `src/utils/process.ts`:

```ts
export function killProcessTree(proc: ChildProcess): void {
    if (proc.pid && proc.pid > 0) {
        try {
            process.kill(-proc.pid, 'SIGTERM'); // Kill process group
        } catch {
            // Process may have already exited
        }
    }
    proc.kill('SIGTERM');
}
```

requires `detached: true` on the spawn to put the child in its own process
group. We change `extensions/pi-agent.ts` to use `detached: true` and call
this helper on timeout and on cleanup.

If SIGTERM is ignored after a grace period (e.g., 5 s), we escalate to SIGKILL
on the process group. Track this in the helper; do not re-implement in
`pi-agent.ts`.

---

## Appendix C: Why XDG and not `os.tmpdir()`

`os.tmpdir()` is shared system-wide (`/tmp` on linux). On a shared host or a
CI runner, two users running pi-webfetch concurrently would race for the same
`/tmp/pi-webfetch-cache` (already a bug in `extensions/cache.ts:9`). Per-user
`XDG_CACHE_HOME` solves this and is the right convention for caches that
survive reboots.

`/tmp` is also cleared by `systemd-tmpfiles` on most distros, which is fine
for short-lived scratch but means stale-dir recovery has a different cadence
than we want.
