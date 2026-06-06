# Changelog

All notable changes to `@rwese/pi-webfetch` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.8.0] - 2026-06-06

### Added

- **Research subagent input files.** Research mode now writes the
  fetched content to `input.md` (and the original un-processed
  response to `input_raw.<ext>` when available) in a session-keyed
  work dir under the system temp dir
  (`<tmpdir>/pi-webfetch-research/<sessionId>/`). The subagent
  references the file paths in its prompt and uses `read` / `grep`
  to load the content on demand, instead of receiving the full
  content inline. This keeps the LLM context small and makes the
  prompt stable across very different page sizes.
- **Lean research prompt.** The prompt is rewritten to be small
  and query-focused: it surfaces the URL, the parent's cwd, the
  session name, the input file paths, and short instructions
  ("Read the input file(s) above and answer the query. Be concise
  and direct; do not pad with generic analysis."). The old
  `## Content to Analyze` block and the generic
  "thorough, well-structured response" boilerplate are gone.
- **Work dir + input file paths on `WebfetchDetails`.** The
  research subagent result details now carry `workDir`,
  `inputFile`, and `inputRawFile` so the user (and the CLI / MCP
  surfaces) can `ls` the work dir and `read` the input files
  directly. The fields are populated on both the success and the
  agent-error paths.
- **Raw content plumbing.** `ProviderFetchResult` and
  `WebfetchDetails` gain optional `rawContent` and `rawContentType`
  fields. The default provider (browser) populates them with the
  raw HTML; the static fetch populates them with the original HTML
  / text / markdown. The cache persists them so a research
  subagent that hits the cache still has the original markup
  available for `input_raw.<ext>`. Providers that already produce
  a clean structured payload (gh-cli, clawfetch) leave them
  `undefined`.
- **`writeInputFiles(sessionId, options)` utility.** New
  `extensions/utils/formatting.ts` helper that creates the
  session-keyed work dir and writes `input.md` + `input_raw.<ext>`.
  Returns the absolute paths so the caller can thread them into
  the spawn options and the result details.

### Changed

- `extensions/pi-agent.ts::buildResearchPrompt` now takes a
  `ResearchPromptInput` object instead of `(query, content)`. The
  content is no longer inlined; the prompt references file paths
  via the new `inputFile` / `inputRawFile` options. The old
  positional `content` arg is accepted by `spawnPiAgent` for
  back-compat but is not used in the prompt body.
- `extensions/pi-agent.ts::SpawnPiAgentOptions` gains three
  additive fields: `url?`, `inputFile?`, `inputRawFile?`. The
  research service threads them through; the prompt surfaces
  them so the subagent can re-look-up the source and grep the
  original markup.
- `extensions/services/static-fetch.ts` populates `rawContent` /
  `rawContentType` on the HTML, markdown, and plain-text paths.
  Binary paths are unchanged (no `rawContent`).
- `src/providers/default.ts` populates `rawContent` /
  `rawContentType` on the browser path so the subagent can grep
  the original HTML when the cheerio/turndown conversion drops
  something.
- `extensions/cache.ts::CacheEntry` and
  `extensions/services/cache-service.ts` persist and restore
  `rawContent` / `rawContentType` so a research subagent that
  hits the cache still has the raw payload available.
## [0.7.3] - 2026-06-06

### Fixed

- **Research subagent timeout bumped from 60s to 180s.** The previous
  default (`Pi agent timed out after 60000ms`) was too tight for
  non-trivial research queries on large pages (e.g. fontawesome.com
  docs) and surfaced as an agent error even when the subagent was
  making progress. The new default is `DEFAULT_PI_AGENT_TIMEOUT_MS`
  (`extensions/pi-agent.ts`, currently 180000ms = 3 min). The
  resumable-subagent flow and the agent-error resume hint from
  0.7.1 stay in place as the fallback for the rare cases that still
  exceed the budget.

### Added

- **CLI:** new `--timeout <ms>` flag for `pi-webfetch webfetch`. When
  `--query` is set, the value is forwarded to the research subagent
  and overrides the 180s default. `0`, negative, and non-integer
  values are rejected.
- **MCP `webfetch` tool:** new optional `timeout` integer field in
  the zod input schema (`z.number().int().positive()`). Forwarded to
  `webfetchResearch` so an MCP client (e.g. Codex) can size the
  research budget per call.
- **pi extension `webfetch` tool:** new optional `timeout` integer
  field on `WEBFETCH_TOOL_PARAMS` (`Type.Integer({ minimum: 1 })`).
  Same forwarding contract as the MCP tool.

### Changed

- `extensions/pi-agent.ts::SpawnPiAgentOptions.timeout` now defaults
  to `DEFAULT_PI_AGENT_TIMEOUT_MS` (180000ms) instead of a hard-coded
  60000. The constant is exported and documented; callers that want
  a different budget pass a positive integer in milliseconds.
- `webfetchResearch` accepts one new additive parameter, `timeout?`
  (positioned after `resumeSource`). All existing call sites compile
  unchanged. The MCP / CLI / tool surfaces each forward their
  `timeout` field to this parameter.
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
