# pi-webfetch Agent Notes

## Current Status

- Date: 2026-06-06.
- Package: `@rwese/pi-webfetch` `0.8.0`, ESM TypeScript.
- Codex MCP support exists in `.codex-plugin/plugin.json`, `.mcp.json`, `extensions/mcp-server.ts`, and `extensions/mcp-tools.ts`.
- Direct CLI exists in `extensions/cli.ts`; package bin is `dist/extensions/cli.js`.
- Local Codex startup issue fixed outside the repo by launching `node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js mcp` instead of spawning `extensions/mcp-server.ts` directly.
- Last focused verification: `npm run validate` clean, 26 test files and 422 tests.

## Structure

```text
extensions/          pi extension, CLI, MCP server/tools, fetch services
src/providers/       provider implementations: default, clawfetch, gh-cli
src/fetch-methods/   fetch strategy registry and static fetch method
test/                Vitest tests, MCP/CLI tests, regression cases
test/fixtures/       offline HTML fixtures and fixture helpers
.codex-plugin/       Codex plugin manifest
.mcp.json            published MCP server launch config
```

## Commands

- Install: `npm install`
- Build: `npm run build`
- Test: `npm test`
- Targeted MCP/CLI tests: `npm test -- --run test/cli.test.ts test/mcp-tools.test.ts`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Full gate: `npm run validate`
- Local MCP dev server: `npm run mcp`
- Published MCP command: `npx -y @rwese/pi-webfetch mcp`
- Package dry run: `npm pack --dry-run`

## Release / Publish Reference

- Prepare package docs/metadata before release: update `README.md`, `CHANGELOG.md`, `package.json` metadata/files/bin if behavior or package contents changed; run `npm install` after dependency/package metadata changes so `package-lock.json` is aligned.
- Build and verify package contents: `npm run validate`, `npm run build`, then `npm pack --dry-run`; inspect output includes expected `dist/`, `extensions/`, `src/`, `.mcp.json`, `.codex-plugin/`, `README.md`, and `LICENSE` files.
- Commit all release-ready source, docs, and package-lock changes first; keep the worktree clean before tagging.
- Choose SemVer bump from the change: `patch` for fixes/docs, `minor` for features, `major` for breaking changes.
- Bump/tag with npm (do not hand-edit versions) so `package.json`, `package-lock.json`, and the `vX.Y.Z` tag stay aligned:
  - `npm version patch -m 'chore(release): bump version to %s'`
  - or `npm version minor -m 'chore(release): bump version to %s'`
  - or `npm version major -m 'chore(release): bump version to %s'`
- Push commit and tag: `git push origin main --follow-tags`.
- Publish only after approval: `npm publish --access public`; confirm the published package with `npm view @rwese/pi-webfetch version` and, if needed, `npx -y @rwese/pi-webfetch@<version> --help`.

## Behavior

- Prefer `rg`, `fd`, `just`, `gh`, `uv`, `python3`, and `pnpm` when appropriate.
- For complex tasks, define TODOs before edits.
- Respect dirty worktrees; do not revert user changes.
- Move directories/files by `cp` to target, validate, then `trash` source.
- Prefer primary sources: project docs, vendor repos, standards.
- Pin container images to exact hashes when adding images.

## Testing Rules

- Regression fixes need tests before code changes when feasible.
- MCP behavior changes require `test/mcp-tools.test.ts` updates and `npm run validate`.
- Direct CLI behavior changes require `test/cli.test.ts` updates and `npm run build`.
- URL fetching regressions use `npm run report-url` and `npm run test:regression`.
- Run linter and tests before committing.
- Pre-commit runs `npm run format:staged`; let it format and re-stage supported source/config files instead of running broad manual `prettier --write` commands.
- Pre-commit hooks are quality gates; fix causes instead of bypassing.

## Architecture Notes

- Provider abstraction: `WebfetchProvider` with `name`, `priority`, `capabilities`, `isAvailable`, `detectUrl`, and `fetch`.
- Provider priority: `default` 10, `gh-cli` 8, `clawfetch` 5. GitHub URLs prefer `gh-cli` when authenticated.
- Markdown post-processing removes auto anchors, extracts embedded images to temp files, and preserves code blocks/tables.
- Research mode fetches content, spawns a pi subprocess for analysis, and falls back to fetched content if analysis fails. The spawn default budget is `DEFAULT_PI_AGENT_TIMEOUT_MS` (`extensions/pi-agent.ts`, 300000ms = 5 min); the CLI / MCP / pi tool each expose a `timeout` knob to override per call.
- Research mode writes the fetched content to a session-keyed work dir (`<tmpdir>/pi-webfetch-research/<sessionId>/input.md`, plus `input_raw.<ext>` when the provider surfaces raw content) and threads the absolute paths into the subagent's spawn options. The prompt is lean: it surfaces the URL, the parent's cwd, the session name, and the file paths; the subagent `read`s / `grep`s the content on demand. The work dir / file paths are returned on `WebfetchDetails` (`workDir`, `inputFile`, `inputRawFile`) on both the success and the agent-error paths.
- **JSON-RPC transport for the research subagent.** The subagent
  is driven as a real, named, persistent `pi --mode rpc` session
  via the thin wrapper in `extensions/pi-rpc-client.ts` (see
  `docs/plans/PI_RPC_NOTES.md` for the protocol quirks). The
  wrapper coalesces `text_delta` events to a 16ms flush cadence
  (one frame at 60fps), auto-dismisses `extension_ui_request`
  events (default `true`), owns the wall-clock `agent_end` timeout
  with a SIGTERM → SIGKILL cascade via `stop()`, and surfaces
  `tool_execution_start` events to the parent via an `onToolCall`
  callback. Tool names map to a parent-friendly phase union
  (`read`/`grep`/`find`/`ls` → `reading`, `bash` → `executing`,
  everything else → `thinking`). `SpawnPiAgentResult.sessionId`
  / `sessionName` are sourced from the live `get_state` response,
  not the pre-computed id, so the resume command always points at
  the actual spawned subagent.
- Binary content is downloaded to temp files and not analyzed.
- Agent-error resume flow: research mode spawns the subagent as a real, named, persistent pi session (`--session-id <id>` / `--name <name>`) so the user can `pi --session <id>` into the failed transcript. On the agent-error path, the in-content fallback stays byte-identical to the pre-change baseline; the resume hint lives in `WebfetchDetails.subagentSessionId` / `subagentSessionName` / `resumeCommand` and a side-channel `notify` (TUI notify on the extension, stderr on the CLI, `_meta.details.notify` on the MCP). See `docs/plans/PLAN_AGENT_ERROR_RESUME.md` for the full design.
- **Provider error classification** (BUG-2026-06-06-JGCMZSET-YZOYE / BUG-2026-06-06-JGCMZSNR-YZOYE). When the default (browser) provider fails, the fetch service catches the `ProviderError`, classifies the cause via its `reason` field (`'unknown' | 'timeout' | 'navigation_failed' | 'low_text_ratio'`), and surfaces it on `WebfetchDetails.providerError`. The optional `cacheNotify` channel is fired once with a `warn`-level message. A transient reason (`timeout`, `navigation_failed`) skips the cache write so the next call within the same TTL re-attempts the browser. Pinned by `test/provider-fallback-notify.test.ts`, `test/provider-net-error.test.ts`, `test/fetch-service-net-error.test.ts`, and `test/browser-large-page.test.ts`.
- **Chromium net-error detection** in `default.ts::detectChromiumNetError`. The rendered body is scanned for known `ERR_<NAME>` codes (`ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`, `ERR_SSL_PROTOCOL_ERROR`, etc.); a hit throws `ProviderError` with `reason: 'navigation_failed'` so the static-fetch path produces the documented `Status: 0 + TypeError: fetch failed` contract. The list is the documented 90 % case; the static-fetch fallback catches the eventual transport failure on retry regardless.
- **MediaWiki MathJax cleanup** (BUG-2026-06-06-JGCMZSOB-YZOYE). `PAGE_DENYLIST_EXTRA` in `default.ts` adds the `mwe-math-*` selectors so `cleanHtml` strips the wrapper; the `addMathJaxRule` turndown rule keeps the rendered `<img>` as a single `![alt](src)` markdown image link. Pinned by `test/wikipedia-math-cleanup.test.ts` against `test/fixtures/wikipedia-pi-math.html`.

## References

- **Live webfetch testing** — `.agents/references/webfetch-testing.md`
  has the 14-call live test matrix, the findings watchlist, and the
  pre-flight / validation commands. Read it before touching
  `extensions/cache.ts`, `extensions/services/*`, the default
  provider in `src/providers/`, or `extensions/markdown.ts`. The
  matrix is derived from `docs/reviews/webfetch-review-2026-06-06.md`.

- **Browser session cleanup in tests** —
  `test/helpers/agent-browser-cleanup.ts` is the
  per-process safety net for `agent-browser` session
  cleanup. Per-test cleanup (each test that spawns a
  `DefaultProvider` / `BrowserManager` must call
  `close()` in `finally`) is the primary fix; the
  helper is the belt-and-braces. **Never** call
  `agent-browser close --all` from a test or the
  helper — the user's other running processes (pi,
  codex) own those sessions, and a blanket close
  would kill them.

## Boundaries

ALWAYS:

- Keep AGENTS.md concise and agent-focused; put user docs in `README.md`.
- Update relevant tests with behavior changes.
- Preserve secrets and personal data; never commit or expose them.
- Use structured APIs/parsers where available.

ASK FIRST:

- Delete files or directories.
- Rewrite large sections unrelated to the task.
- Modify shared user config outside the repo.
- Change published package metadata or release scripts.

NEVER:

- Commit secrets, tokens, credentials, or personal config.
- Bypass quality gates or pre-commit hooks.
- Use destructive git commands unless explicitly requested.
- Spawn `extensions/mcp-server.ts` directly as an executable; use `npm run mcp`, `npx -y @rwese/pi-webfetch mcp`, or `node dist/extensions/cli.js mcp`.
