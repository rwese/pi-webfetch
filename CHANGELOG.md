# Changelog

All notable changes to `@rwese/pi-webfetch` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.7.1] - 2026-06-05

### Added

- MIT `LICENSE` file and `package.json` license metadata so published
  tarballs include explicit license terms.
- **Resumable research subagent.** Research mode now spawns the
  analysis subagent as a real, named, persistent pi session via
  `pi -p --name "<n>" --session-id "<id>" "<prompt>"`. The session
  id is `sha256(timestamp + url + query)` truncated to 16 hex chars
  (deterministic for the same `(now, url, query)` triple, unique
  per invocation). The session name is `webfetch-research: <host>`.
- **Agent-error resume hint.** On the agent-error path, three new
  optional fields are populated on `WebfetchDetails`:
  - `subagentSessionId` - the persistent session id of the failed
    subagent.
  - `subagentSessionName` - the human-readable session name (visible
    in `pi -r`).
  - `resumeCommand` - the exact command the user should run. The
    extension emits `pi --session <id>` (cwd-resumable, run from the
    same dir). The CLI / MCP emit
    `pi-webfetch webfetch <url> --query <query>` (a brand new
    subagent session is created on the next call).
- **Surface-specific notify channel.** A new optional `notify` field
  on `WebfetchDetails` carries the multi-line resume hint. The
  extension surfaces it via `ctx.ui.notify`; the CLI writes it to
  stderr; the MCP server returns it under `_meta.details.notify` so
  an MCP client (e.g. Codex) can show it to the user.

### Fixed

- GitHub web URLs now route to the authenticated `gh-cli` provider even
  when the higher-priority generic provider does not detect the GitHub
  fast path.
- CLI `webfetch <url>` without flags is covered as deterministic
  plain-text output, and cache miss/stats CLI contracts are tested.
- Wikipedia/MediaWiki extraction strips navboxes, print footers, and
  category links from converted markdown.

### Changed

- The in-content `## Fetch Result (Agent Error)` markdown body is
  byte-identical to the pre-change baseline. The resume hint lives
  outside the agent's context (TUI / stderr / `_meta.details`).
- `extensions/pi-agent.ts::SpawnPiAgentOptions` accepts two additive
  fields, `sessionId?` and `sessionName?`, which are passed through
  as `--session-id <id>` and `--name <name>` argv. The result echoes
  them back so callers can build resume hints.
- `webfetchResearch` accepts three additive parameters, `now()`,
  `notify`, and `resumeSource` (default `'extension'`). All
  existing call sites compile.

## [0.6.0] - 2026-06-04

### Added

- New `GitHubFetchOptions` object threaded from the CLI / MCP / pi
  extension down to the `gh-cli` provider. The first option is
  `includeComments` (boolean). When `true`, issue conversation
  comments and PR review threads are included in the result.
- CLI: new `--include-comments` flag for `pi-webfetch webfetch`.
  Accepts bare flag, `--include-comments=true`, `--include-comments=false`,
  `yes` / `no`, or `1` / `0`.
- MCP `webfetch` tool: new `includeComments` boolean in the zod input
  schema.
- pi extension `webfetch` tool: new `includeComments` boolean in the
  TypeBox schema (`WEBFETCH_TOOL_PARAMS`).
- Discovery hint: when an issue / PR is fetched without
  `includeComments`, a `> Tip: pass `includeComments: true` ...`
  footer is appended to the markdown content. The same string is
  mirrored as `metadata.githubHint` on the provider's
  `ProviderFetchResult` and as `githubHint` on `WebfetchDetails`,
  so programmatic callers can prompt the user to opt in.

### Changed

- **Default-output change for GitHub issues:** issue conversation
  comments are no longer included by default. Pass
  `--include-comments` (or `includeComments: true` from MCP / the
  pi extension) to restore the previous behaviour. A discovery hint
  is added in its place.
- **Default-output change for GitHub PRs:** PR review thread bodies
  and PR conversation comments are no longer included by default.
  Same opt-in mechanism as for issues.

### Tests

- New `test/gh-cli-options.test.ts` covering `fetchByType` argv
  construction (with and without `--comments`), the discovery
  hint, and `metadata.githubHint` for both issues and PRs.
- New `test/fetch-service-github-hint.test.ts` covering the
  fetch-service plumbing that mirrors `metadata.githubHint` to
  `WebfetchDetails.githubHint` and appends the in-content tail.
- `test/cli.test.ts` and `test/mcp-tools.test.ts` extended for the
  new flag / schema field and forwarding to `webfetchResearch`.
- New `test/cache-key-options.test.ts` covering the option-scoped
  cache key fix.

### Fixed

- The cache was URL-only, so a previous `webfetch` call (without
  `includeComments`) would return a stale result with the `> Tip:`
  discovery hint when a later call passed `includeComments: true`.
  The cache key is now scoped by a stable hash of the provider
  fetch options, so option combinations that affect output
  (`includeComments` today, future options additively) each get
  their own cache entry.
