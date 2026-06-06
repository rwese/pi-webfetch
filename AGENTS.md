# pi-webfetch Agent Notes

## Current Status

- Date: 2026-05-11.
- Package: `@rwese/pi-webfetch` `0.2.1`, ESM TypeScript.
- Codex MCP support exists in `.codex-plugin/plugin.json`, `.mcp.json`, `extensions/mcp-server.ts`, and `extensions/mcp-tools.ts`.
- Direct CLI exists in `extensions/cli.ts`; package bin is `dist/extensions/cli.js`.
- Local Codex startup issue fixed outside the repo by launching `node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js mcp` instead of spawning `extensions/mcp-server.ts` directly.
- Last focused verification: `npm test -- --run test/cli.test.ts test/mcp-tools.test.ts` passed, 2 files and 13 tests.

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

- Use absolute paths in commands and file references.
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
- Pre-commit hooks are quality gates; fix causes instead of bypassing.

## Architecture Notes

- Provider abstraction: `WebfetchProvider` with `name`, `priority`, `capabilities`, `isAvailable`, `detectUrl`, and `fetch`.
- Provider priority: `default` 10, `gh-cli` 8, `clawfetch` 5. GitHub URLs prefer `gh-cli` when authenticated.
- Markdown post-processing removes auto anchors, extracts embedded images to temp files, and preserves code blocks/tables.
- Research mode fetches content, spawns a pi subprocess for analysis, and falls back to fetched content if analysis fails. The spawn default budget is `DEFAULT_PI_AGENT_TIMEOUT_MS` (`extensions/pi-agent.ts`, 180000ms = 3 min); the CLI / MCP / pi tool each expose a `timeout` knob to override per call.
- Binary content is downloaded to temp files and not analyzed.
- Agent-error resume flow: research mode spawns the subagent as a real, named, persistent pi session (`--session-id <id>` / `--name <name>`) so the user can `pi --session <id>` into the failed transcript. On the agent-error path, the in-content fallback stays byte-identical to the pre-change baseline; the resume hint lives in `WebfetchDetails.subagentSessionId` / `subagentSessionName` / `resumeCommand` and a side-channel `notify` (TUI notify on the extension, stderr on the CLI, `_meta.details.notify` on the MCP). See `docs/plans/PLAN_AGENT_ERROR_RESUME.md` for the full design.

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
