# Changelog

All notable changes to `@rwese/pi-webfetch` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (2026-07-21 research model selector)

- **Persistent research-subagent model selection.** The new
  `/webfetch:model` slash command opens a searchable selector populated
  from Pi's available model registry. It filters by provider, model ID,
  or display name. The selected provider/model is
  stored in `<pi-agent-dir>/pi-webfetch.json` and passed to extension
  research subprocesses via `--provider` and `--model`, without changing
  the parent session model. Selecting **Use Pi default model** clears the
  override.

### Added (2026-06-07 browser-session-cleanup audit)

- **Browser session cleanup in tests.** Per-test
  cleanup in `test/browser-large-page.test.ts`,
  `test/browser-tab-isolation.test.ts`, and
  `test/provider-net-error.test.ts` (the
  `DefaultProvider` / `BrowserManager` instances each
  test creates are now closed in a `try/finally`
  block). Plus a process-level safety net:
  `test/helpers/agent-browser-cleanup.ts` registers a
  `process.on('beforeExit')` hook (wired via
  `test/setup.ts` and `vitest.config.ts::setupFiles`)
  that closes the **current test process's session**
  on exit. The hook is scoped to
  `agent-browser close --session <our-name>` and
  **never** calls `agent-browser close --all`, so it
  does not touch the user's other running processes'
  sessions on the same host. Pinned by 8 new tests in
  `test/agent-browser-cleanup.test.ts` (1 unit, 4
  `cleanupCurrentSession`, 1 register-idempotency, 1
  re-fire guard, 1 end-to-end against a real
  `agent-browser`).

### Changed (2026-06-10 timeout bump)

- **Research subagent timeout bumped from 180s to 300s (5 min).**
  The previous 3-minute default was still too tight for
  complex research queries on large pages, causing
  `Pi agent timed out after 180000ms`. The new default is
  `DEFAULT_PI_AGENT_TIMEOUT_MS` (`extensions/pi-agent.ts`,
  300000ms = 5 min). All user-facing docs, the CLI help,
  and the MCP schema description updated accordingly.

### Changed (2026-06-07 browser-session-cleanup audit)

- **Refactor (test): deterministic error-handling test.**
  The previous `handles fetch error gracefully` test
  in `test/providers.test.ts` did a real network call
  to a non-existent domain. On hosts with
  `agent-browser` installed, the default provider
  spawned a real browser session and the test never
  closed it (the leak from the 2026-06-07 audit). The
  new test injects a failing provider via
  `new ProviderManager({}, undefined, [failingProvider])`
  and asserts the manager returns the documented
  `{ success: false, error, attemptedProviders }`
  shape. No real network, no real browser, no leak;
  the DNS-resolution flake is gone.

### Added (v0.9.0 / 2026-06-06 review fixes)

- **Provider error classification (BUG-2026-06-06-JGCMZSET-YZOYE).**
  New `reason` field on `ProviderError`
  (`'unknown' | 'timeout' | 'navigation_failed' | 'low_text_ratio'`)
  and a new `providerError: { provider, reason, message }` field on
  `WebfetchDetails` and `ProviderFetchResult`. When the default
  (browser) provider fails, the fetch service classifies the cause
  and surfaces it on the optional `cacheNotify` channel (TUI
  notify on the extension, stderr on the CLI, `_meta.details.notify`
  on the MCP). A transient reason (`timeout`, `navigation_failed`)
  skips the cache write so the next call re-attempts the browser.
  Pinned by `test/provider-fallback-notify.test.ts` and
  `test/fetch-service-net-error.test.ts`.
- **Chromium net-error detection (BUG-2026-06-06-JGCMZSNR-YZOYE).**
  New `detectChromiumNetError(body)` helper in `default.ts` and a
  scan in the `extractHtml` / `extractText` paths. When the rendered
  body contains a known Chromium net-error string
  (`ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`,
  `ERR_SSL_PROTOCOL_ERROR`, etc.), the provider throws a
  `ProviderError` with `reason: 'navigation_failed'`. The fetch
  service falls back to static fetch, which produces the documented
  `Status: 0 + Error: TypeError: fetch failed` for a DNS-failure URL
  (the test matrix contract for call 8). Pinned by
  `test/provider-net-error.test.ts`.
- **MediaWiki MathJax cleanup (BUG-2026-06-06-JGCMZSOB-YZOYE).**
  Wikipedia inline MathJax `<span class="mwe-math-*">` wrappers
  used to leak the formula's TeX source 3-4 times per formula
  (the MathML `<annotation encoding="TeX">`, the `<img alt="...">`,
  and a `<span style="display: none">` fallback). The v0.9.0 fix
  adds the MathJax selectors to `PAGE_DENYLIST_EXTRA` in the
  default provider (so `cleanHtml` strips the wrapper) and a new
  `addMathJaxRule` turndown rule that keeps the rendered `<img>`
  as a single `![alt](src)` markdown image link. Pinned by
  `test/wikipedia-math-cleanup.test.ts` and the
  `test/fixtures/wikipedia-pi-math.html` fixture.

### Changed

- **Per-`get` browser timeout cap removed.** The 5 s cap on
  `agent-browser get html article|main` in
  `BrowserManager.pickContentSource` was the root cause of the
  silent fallback for large Wikipedia pages (BUG-2026-06-06-JGCMZSET-YZOYE).
  The per-`get` timeout is now the caller-supplied `timeout`
  (30 s default); the global timeout is the only budget owner.
  Pinned by `test/browser-large-page.test.ts`.

- **Cache TTL (review finding 1, M1.A).** New
  `isFresh(entry, now, ttlMs?)` helper and
  `DEFAULT_CACHE_TTL_MS = 1 hour`. The cache layer is now
  TTL-aware: a stale entry is treated as a miss and
  re-fetched, so a "1 day ago" entry cannot haunt the
  current session. Surface across the CLI
  (`--cache-ttl <ms>`), the MCP `webfetch` tool
  (`cacheTtlMs`), the pi extension tool, and the
  `WebfetchDetails` shape. Pinned by
  `test/cache-ttl.test.ts`.
- **Cache content validation (review finding 1, M1.B).** New
  `validateCacheEntry(entry, requestedUrl)` cross-checks the
  provider's `finalUrl` (post-redirect URL) and the rendered
  `<title>` (from `metadata.title` or extracted from
  `rawContent`) against the requested URL. A mismatch rejects
  the cache write with a warning on `WebfetchDetails.notify`
  (and the `notify` callback the caller supplied). The
  original `FetchResult` flows through unchanged. Pinned by
  `test/cache-content-validation.test.ts`.
- **Per-process `agent-browser` session (M1.C).** The
  default provider's `BrowserManager` derives
  `AGENT_BROWSER_SESSION = ${os.hostname()}:${process.pid}`
  once in its constructor and passes it on every `execAsync`
  call. Two concurrent `webfetch` processes on the same host
  each get their own browser instance.
- **Per-fetch browser tab (review finding 6, M1.D).** The
  default provider allocates a fresh
  `agent-browser tab new <url> --label webfetch-<uuid>` for
  every fetch and closes it in `finally`. Replaces the v0.8.0
  `currentUrl` skip-open shortcut that was the root cause of
  the cache-poisoning race. Pinned by
  `test/browser-tab-isolation.test.ts`.
- **`webfetch-clear-cache` batch UX (review finding 11,
  M1.E).** New `--all`, `--older-than <duration>`, and
  `--dry-run` flags on the CLI, the TUI
  `/webfetch-clear-cache` slash command, and the
  `clearAllCache({ olderThanMs })` /
  `clearCacheOlderThan(url, ms)` helpers. Accepts `7d`,
  `2h`, `30m`, `45s`, `1500ms`, or a bare integer in ms.
  Pinned by `test/clear-cache-flags.test.ts`.
- **New `docs/cache.md`** describing the cache on-disk
  layout, TTL defaults, content validation, and the
  per-process / per-tab isolation guarantees.
- **User-facing provider rename (review finding 8, M3.B).**
  `DefaultProvider.displayName` is now `"browser"` (the
  internal `WebfetchProvider.name` stays `"default"` for
  back-compat with the `--provider` flag and the provider
  manager's priority sort). Surfaces on
  `WebfetchDetails.provider` and the
  `Processed as: ...` header. Pinned by
  `test/provider-name.test.ts`.
- **`Processed as: ...` enum widened (review finding 10,
  M3.C).** New `processedAs` values `html`, `static`,
  `cache`, and `binary`; the `markdown` value is renamed to
  `static` to match the fetch path. The user-facing label
  reads naturally for each path (`spa` for real-browser
  network-idle, `html` for real-browser domcontentloaded,
  `static` for HTTP-only, `cache` for cache hit, `binary`
  for downloads). Pinned by
  `test/processed-as-labels.test.ts`.
- **Inline images by default (review finding 2, M2.B).**
  `extractEmbeddedImages` now keeps inline
  `![alt](url)` references intact (no `[ref-N]`
  placeholders, no temp file). Pass `{ extract: true }` for
  the pre-v0.9.0 behaviour. Pinned by
  `test/image-inlining.test.ts`.
- **Selector denylist (review finding 3, M2.C).** New
  `DEFAULT_DENYLIST_SELECTORS` exported from
  `src/providers/internal/turndown-config.ts`, plus a
  `cleanHtml(html, { extraSelectors })` option. The default
  provider threads a page-specific denylist (Wikipedia
  donation banner, siteNotice, etc.) so a Wikipedia article
  no longer starts with the donation banner. Pinned by
  `test/denylist.test.ts`.
- **Wikitable turndown rule (review finding 4, M2.D).**
  Custom `wikitable` rule on `TurndownService` emits GFM
  tables directly from the DOM, normalises the column
  count, and escapes `|` characters in cell text. Pinned
  by `test/table-wikitables.test.ts`.
- **Un-escape brackets (review finding 5, M2.E).** New
  `unescapeBrackets(markdown)` strips `\[` / `\]` outside
  fenced code blocks, with special-casing for image syntax
  (`\!\[alt\](url)`) so image references survive. Wired
  into `fetchUrl` and `staticFetch` so Wikipedia footnote
  references (`\[1\]`, `\[2\]`) read naturally. Pinned by
  `test/markdown-unescape.test.ts`.
- **Sticky `staticOnly` warning (review finding 7, M3.D).**
  The `browserWarning` field on `WebfetchDetails` is set
  only on the static-fallback path (`processedAs:
  'fallback'`), not on the static pass-through
  (`processedAs: 'static'`) or on binary downloads. The
  warning is sticky: it surfaces in the user-facing
  `## Fetch Result` header. Pinned by
  `test/static-only-warning.test.ts`.

### Changed

- **Research subagent transport: print-mode → JSON-RPC.** The
  research subagent is now driven as a real, named, persistent
  `pi --mode rpc` session instead of the previous `-p <prompt>`
  print-mode spawn. The wrapper is `extensions/pi-rpc-client.ts`
  (see `docs/plans/PI_RPC_NOTES.md` for the protocol quirks).
  No behavior change for callers — just a new live-progress UX:
  text deltas stream back to the parent (debounced to one frame
  at 60fps), tool events map to parent-friendly phases
  (`read`/`grep`/`find`/`ls` → `reading`, `bash` → `executing`,
  everything else → `thinking`).

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
