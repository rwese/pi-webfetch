# Webfetch Review Fixes — 2026-06-06

## Context

<goal>Address every finding in [`docs/reviews/webfetch-review-2026-06-06.md`](../reviews/webfetch-review-2026-06-06.md) in a single v0.9.0 release, organised as three sequential milestones (correctness → markdown fidelity → polish). The release must be self-contained: tests, CHANGELOG, README, and the new CLI flags all ship together. No finding may regress; no new bug may be introduced by a milestone-1 fix that lets milestone-2 work.</goal>

The review is hands-on, against published `v0.8.0`; eleven findings are ranked by severity and grouped here into three release-internal milestones. The review doc itself stays authoritative for the per-finding evidence.

### Findings → Milestones

| # | Severity | Finding | Milestone |
|---|----------|---------|-----------|
| 1 | **BLOCKER** | Cache has no TTL and no content validation | M1 (Correctness) |
| 2 | HIGH | Markdown image references render as broken `[ref-N]` | M2 (Fidelity) |
| 3 | HIGH | Wikipedia donation banner is captured as content | M2 |
| 4 | MEDIUM | Wikipedia tables are mangled | M2 |
| 5 | MEDIUM | Markdown post-processing mangles escaped brackets | M2 |
| 6 | MEDIUM | Default provider reuses a single browser tab | M1 (Correctness) |
| 7 | MEDIUM | `agent-browser` fallback warning shown on every call | M3 (Polish) |
| 8 | LOW | "default" provider name in `details.provider` is confusing | M3 |
| 9 | LOW | Static-fallback cache hit discards raw HTML | M3 (verification; partially already fixed — see Implementation Notes) |
| 10 | LOW | `Processed as: spa` for pages that are not SPAs | M3 |
| 11 | LOW | `webfetch-clear-cache` is per-URL; no batch UX | M3 |

### Why M1 = Findings 1 + 6

The review's "Suggested next steps" call them out as a pair: the cache-poisoning (1) is caused by a browser-tab race (6), and either fix on its own is incomplete. They land together as the correctness milestone.

## Scope

**In Scope (v0.9.0):**

- All 11 findings from `docs/reviews/webfetch-review-2026-06-06.md`.
- New public surface: `cacheTtlMs` option on `fetchUrl` / `webfetchSPA`; `--cache-ttl` on the `webfetch` CLI subcommand; `cacheTtlMs` on the MCP `webfetch` tool and pi-extension `webfetch` tool. The option is an override on top of a fixed default; we do not expose a "no TTL" mode.
- New CLI surface: `webfetch-clear-cache --all` (already implemented; surface in help and README), `--older-than <duration>`, `--dry-run`.
- Regression test fixtures under `test/fixtures/` for the poisoned-cache case (URL+content mismatch) and the concurrent-fetch case (two `BrowserManager` instances racing the same URL).
- CHANGELOG, README, and BACKLOG updates.

**Out of Scope (deferred; already in `BACKLOG.md`):**

- Git-protocol URLs, GitHub Enterprise hosts, recursive directory listings, PR diffs.
- Size guard on `fetchFile` raw content (gh-cli).
- Provider health checks, retry logic, proxy/UA/header support, bot protection, security hardening.
- The gh-cli-as-requirement and detector-alignment gaps from the prior review.

## Acceptance Criteria

### M1 — Correctness

- [x] **Finding 1.a** — `CacheEntry.cachedAt` is checked against `cacheTtlMs` (default `60 * 60 * 1000` ms = 1 hour) in `getCachedResult`. An entry older than the TTL is treated as a miss.
- [x] **Finding 1.b** — The new `cacheTtlMs` option is wired through `fetchUrl` / `webfetchSPA` and surfaced on `ProviderFetchOptions` / `GitHubFetchOptions`'s sibling type. The CLI `--cache-ttl <ms>` and MCP / extension `cacheTtlMs` knobs forward to it.
- [x] **Finding 1.c** — Before persisting a cache entry, `buildCacheEntry` (or a new `validateCacheEntry`) cross-checks the rendered `<title>` (or, when present, `result.finalUrl`) against the requested URL. Mismatch → entry is **not** persisted and a warning is logged on `details.notify` (extension) / stderr (CLI) / `_meta.details.notify` (MCP). The original provider result is returned unmodified so the caller retries.
- [x] **Finding 1.d** — `webfetch-clear-cache` accepts `--all`, `--older-than <duration>` (e.g. `7d`, `2h`, `30m`), and `--dry-run`. Help text and README document the new flags.
- [x] **Finding 1.e** — `docs/cache.md` (new) documents the cache key (URL + provider options, sha256), the TTL default, the denylisted hosts, and the on-disk path so users can `rm` a poisoned file by hand.
- [x] **Finding 6.a** — Each `BrowserManager.extractHtml` call uses a per-process `AGENT_BROWSER_SESSION` (computed once as `hostname + ':' + pid`) and a per-fetch tab id (`crypto.randomUUID()`), passed via `agent-browser open --tab <id>` (or the documented equivalent). The tab is closed in a `finally` block via `agent-browser tab close --id <id>`.
- [x] **Finding 6.b** — The per-process session name is computed once and reused for the lifetime of the process. Per-process state is reset on `safeClose` (the long-idle timeout).
- [x] **Finding 6.c** — The single-tab optimisation (`currentUrl` skip-`open` shortcut) and the `BrowserManager.idleTimeout` are removed; `BrowserManager` becomes a thin wrapper that owns the session name and tab lifecycle.
- [x] **Finding 6.d** — Two concurrent `fetchUrl` calls on the same `BrowserManager` are still serialised by the existing `BrowserMutex`; two concurrent webfetch **processes** on the same host each get their own session and never see each other's tabs. Verified by a regression test that spawns two `BrowserManager` instances in the same process and confirms the tabs do not collide.

### M2 — Markdown fidelity

- [x] **Finding 2** — `<img>` elements in the converted markdown become `![alt](absolute-url)` (inlined) by default. The optional `extractEmbeddedImages` path stays as the user-opt-in behaviour (today: extracted to a temp file with `[ref-N]` placeholders). The two paths must not emit `[ref-N]` references without their `[ref-N]:` definitions. New unit test pins the inlined shape for a Wikipedia fixture.
- [x] **Finding 3** — A selector denylist in `BrowserManager.extractHtml` (and `cleanHtml` in `turndown-config.ts`) removes:
  - `[class*="fundraiser" i], [class*="donate" i], [id*="donate" i]`
  - `[role="banner" i], [role="dialog" i]`
  - `<aside>` elements not specifically marked `<aside role="note">`
  - The Wikipedia-specific `[id*="centralNotice" i]` (the fundraiser banner) and `.mw-notification-area`
  The denylist is applied **before** cheerio / turndown see the HTML.
- [x] **Finding 4** — A `wikitables` turndown rule detects `table.wikitable` and emits a pipe-table with the first `<tr>`'s `<th>` cells as the header row. Post-processing in `extensions/markdown.ts` rebuilds malformed tables by re-reading `<th>`-headed `<tr>` rows.
- [x] **Finding 5** — `removeMarkdownAnchors` (or a new `unescapeMarkdownBrackets` helper) un-escapes `\[`, `\]`, `\*`, `\_`, `` \` ``, `\<`, `\>` in the post-processing pass. New unit test pins the un-escape.

### M3 — Polish

- [x] **Finding 7** — The `browserWarning: 'Using static fetch (no browser provider available)'` line is shown **once per session** (sticky in the `WebfetchDetails` of the first fallback result) and is replaced by a single `details.staticOnly: true` flag for subsequent calls. The first warning is still appended to content.
- [x] **Finding 8** — The `DefaultProvider.name` value used in `details.provider` is renamed to `'browser'`. The `WebfetchDetails.provider` field is documented as: `'gh-cli' | 'browser' | 'clawfetch' | 'static'`. `'default'` is reserved for "auto-select at the manager level" and is not used in user-facing details.
- [x] **Finding 9** — Already addressed for the static HTML and text/markdown paths in `v0.8.0` (`static-fetch-raw.test.ts` covers it). The M3 task is to (a) re-verify the test still passes, and (b) close the review finding in CHANGELOG / BACKLOG with a "verified, no code change needed" note. If the verification surfaces a regression in the binary path (where `rawContent` is intentionally absent), document the reason in a code comment.
- [x] **Finding 10** — `processedAs` gains `'spa'` (network-idle wait, real browser), `'html'` (domcontentloaded wait, real browser, no SPA heuristic), and `'static'` (HTTP only). The provider reports the actual wait condition; `fetch-service.ts` propagates it. Existing test snapshots that pin `'spa'` are updated to the correct value.
- [x] **Finding 11** — `webfetch-clear-cache` help and README document `--all`, `--older-than <duration>`, `--dry-run`. Examples added to README.

## First Verifiable State

**Order first, not time.** Milestone 1 starts with the smallest unit of verifiable work — a TTL-aware `getCachedResult` with a regression test — then layers the content-validation pass and the per-tab refactor on top.

- [ ] **First task (M1, sub-step A):** Add the `cacheTtlMs` parameter to `getCachedResult` / `getCache` and a `CacheEntry`-level "is this entry still fresh?" check. Add `test/cache-ttl.test.ts` with three cases: fresh (within TTL), stale (older than TTL), and a user-overridden TTL that overrides the default. **Verify:** `npm test -- --run test/cache-ttl.test.ts` passes; `npm run validate` green.
- [ ] **First task (M2):** Pin the current inlining behaviour with a test in `test/image-inlining.test.ts` (Wikipedia fixture → `![alt](absolute-url)`). This locks the **before** state before we change the default. **Verify:** test passes against the unmodified code.
- [ ] **First task (M3):** Add `test/processed-as-labels.test.ts` that asserts the new `processedAs` union and that the four existing label values map to the new strings. **Verify:** test passes against the unmodified code (with the union widened); the labels are updated in a follow-up.

## Implementation Notes

### Tech decisions

- **TTL default** — 1 hour. Long enough to dedupe a single user session's repeat fetches, short enough that "1 day ago" entries cannot haunt a user. Override is per-call; we do not persist a per-user default.
- **Content validation** — Compare the rendered `<title>` against a fuzzy URL-derived expectation (the URL's path component, lowercased, with `-` and `_` collapsed). If a provider surfaces `result.finalUrl` (the default provider already does), prefer that exact comparison. The check is a **warn-and-skip-persist**, never a re-throw: the caller gets the original `FetchResult` and decides whether to retry.
- **Per-process session name** — `AGENT_BROWSER_SESSION=${os.hostname()}:${process.pid}`. Stable for the lifetime of the process; deterministic enough that humans can identify it in `agent-browser session list`. Resolved once in `BrowserManager` and reused for every call.
- **Per-fetch tab id** — `crypto.randomUUID()`. Each `extractHtml` / `extractText` call gets its own tab; the tab is closed in `finally` regardless of success or failure.
- **Inlined images** — The default changes from "extract to temp file with `[ref-N]` references" to "inline `![alt](absolute-url)`". The extract-to-temp-file path is kept as an opt-in (e.g. `images: 'extract'` config knob) for users who want a side-channel file.
- **Turndown rule ordering** — The new `wikitables` rule is registered **after** `preserveCodeBlocks` so it does not clobber `<pre><code>` inside table cells (rare but real on Wikipedia's code-heavy articles).
- **Denylist application** — Applied in two places: `cleanHtml` (cheerio remove) in `turndown-config.ts` for the static path, and a cheerio pre-pass in `BrowserManager.extractHtml` for the browser path. Both use the same selector list to keep behaviour consistent across providers.
- **Provider name `'default'` vs `'browser'`** — Internal `WebfetchProvider.name` keeps `'default'` (it's the registered name in the manager). Only the user-facing `WebfetchDetails.provider` / `ProviderFetchResult.providerName` switch to `'browser'`. The mapping lives in `DefaultProvider.fetch` and a one-liner in `gh-cli` / `clawfetch` for consistency.

### Key files to touch

- M1:
  - `extensions/cache.ts` — add `isFresh(entry, ttlMs)`; add `clearCacheOlderThan(ms)`; add `clearAllCache({ olderThanMs })`.
  - `extensions/services/cache-service.ts` — TTL check in `getCachedResult`; `validateCacheEntry` helper; thread `cacheTtlMs` through `cacheFetchResult`.
  - `extensions/services/fetch-service.ts` — `ProviderFetchOptions` gains `cacheTtlMs?: number`; `fetchUrl` / `webfetchSPA` accept and forward.
  - `extensions/types.ts` — add `cacheTtlMs?: number` on `ProviderFetchOptions` and on `FetchConfig`-equivalent.
  - `src/providers/internal/browser-manager.ts` — per-process session name; per-fetch tab id; remove `currentUrl` skip-open shortcut; `finally` closes the tab.
  - `src/providers/default.ts` — `name` stays `'default'` for routing; `providerName` returned on `ProviderFetchResult` becomes `'browser'`.
  - `extensions/cli.ts` — add `--cache-ttl <ms>` to `webfetch` subcommand.
  - `extensions/mcp-tools.ts` — add `cacheTtlMs: z.number().int().positive().optional()` to the `webfetch` zod schema.
  - `extensions/tools/webfetch.ts` — add `cacheTtlMs: Type.Optional(Type.Number())` to the `WEBFETCH_TOOL_PARAMS` TypeBox schema.
  - `extensions/commands/webfetch-cache-command.ts` — new `webfetch:clear-cache` command that accepts `--all`, `--older-than <duration>`, `--dry-run`; keep the existing `webfetch:cache` (stats) command.
  - `extensions/commands/index.ts` — register the new command.
  - `docs/cache.md` (new) — cache key, TTL default, denylisted hosts, on-disk path, manual recovery (`rm`).
  - `README.md` — `--cache-ttl` flag, new `webfetch-clear-cache` flags, link to `docs/cache.md`.
- M2:
  - `extensions/markdown.ts` — un-escape brackets helper; rewrite `extractEmbeddedImages` to keep `[ref-N]` references only when both halves are present, otherwise fall back to inline.
  - `src/providers/internal/turndown-config.ts` — `wikitables` rule; selector denylist in `cleanHtml`.
  - `src/providers/internal/browser-manager.ts` — selector denylist applied before returning HTML.
  - `extensions/services/fetch-service.ts` and `static-fetch.ts` — call the updated `removeMarkdownAnchors` / image paths consistently.
- M3:
  - `extensions/services/fetch-service.ts` — `staticOnly` flag; first-time-only `browserWarning`.
  - `extensions/content-types.ts` and `extensions/types.ts` — widen `processedAs` union to include `'html'`.
  - `src/providers/default.ts` — return `providerName: 'browser'`.
  - `src/providers/gh-cli.ts` and `src/providers/clawfetch.ts` — keep their names but ensure consistency.
  - `extensions/commands/webfetch-cache-command.ts` — surface `--all`, `--older-than`, `--dry-run` in help and README.

### Tests needed

- M1:
  - `test/cache-ttl.test.ts` (new): fresh, stale, override.
  - `test/cache-content-validation.test.ts` (new): poisoned-cache fixture (URL → content with mismatched `<title>`) is not persisted; warning is logged.
  - `test/browser-tab-isolation.test.ts` (new): two `BrowserManager` instances in the same process get distinct `AGENT_BROWSER_SESSION` and tab ids; a tab close in `finally` happens even when `extractHtml` throws.
  - `test/clear-cache-flags.test.ts` (new): `--all`, `--older-than`, `--dry-run` happy paths.
  - `test/cli.test.ts` — extend to cover `--cache-ttl`.
  - `test/mcp-tools.test.ts` — extend to cover `cacheTtlMs` in the zod schema.
- M2:
  - `test/image-inlining.test.ts` (new): Wikipedia fixture pins `![alt](absolute-url)` shape.
  - `test/denylist.test.ts` (new): fundraiser-banner fixture, dialog modal fixture, aside-content fixture.
  - `test/table-wikitables.test.ts` (new): `wikitable` HTML → pipe-table markdown; non-`wikitable` table still uses the default.
  - `test/markdown-unescape.test.ts` (new): `\[1\]`, `\*bold\*`, `\_em\_` → un-escaped.
  - `test/cases/en-wikipedia-pi.md` (regression) — refresh snapshot; new content should not contain `[ref-N]` placeholders or the fundraiser banner.
- M3:
  - `test/processed-as-labels.test.ts` (new): union widening, label mapping.
  - `test/static-only-warning.test.ts` (new): first call shows warning; second call does not.
  - `test/provider-name.test.ts` (new): `details.provider === 'browser'` for default-provider results; `=== 'gh-cli'` for gh-cli results; routing layer still uses internal `'default'`.
  - `test/static-fetch-raw.test.ts` — re-run to confirm M3 verification (no code change expected).

### Non-goals reaffirmed

- We do not change URL routing, the `gh-cli` provider, the research subagent, or the `WebfetchProvider` interface.
- We do not introduce a new "auto-select" provider (the manager-level default already exists and is unchanged).
- We do not change the cache key derivation (`sha256(url + cacheKey suffix)`); we only add TTL and validation.

## Incremental Plan

### Milestone 1 — Correctness (Findings 1, 6)

1. **[Verification First — TTL]** — Add `isFresh(entry, ttlMs)` in `extensions/cache.ts`; thread `cacheTtlMs?: number` through `getCachedResult` and `cacheFetchResult`; default TTL = 1 h; CLI / MCP / pi-tool / extension all surface the option. Add `test/cache-ttl.test.ts`. **Verify:** `npm test -- --run test/cache-ttl.test.ts` green; full `npm run validate` green.
2. **[Verification First — content validation]** — Add `validateCacheEntry(entry, requestedUrl)`; before `setCache`, compare `<title>` (cheerio extract) and `finalUrl` against the requested URL. Mismatch → log warning on `details.notify` / stderr / `_meta.details.notify`; do not persist. Add `test/cache-content-validation.test.ts` with a poisoned fixture. **Verify:** the new test passes; existing `test/cases/*` regression snapshots remain green.
3. **[Core Logic — per-process session]** — In `BrowserManager` constructor, compute `sessionName = \`${os.hostname()}:${process.pid}\`` and pass it via the `AGENT_BROWSER_SESSION` env var on every `execAsync` call (or via `--session` argv on `agent-browser open`, per the binary's documented API). Update the existing `BrowserManager` tests to assert the env is set. **Verify:** `npm test -- --run test/resource-cleanup.test.ts` green.
4. **[Core Logic — per-fetch tab]** — Replace the `currentUrl` skip-open shortcut with a per-fetch tab id (`crypto.randomUUID()`). `extractHtml` always calls `agent-browser open <url> --tab <id> --session <sessionName>`; closes the tab in `finally` via `agent-browser tab close --id <id>`. Remove the idle timeout and the `currentUrl` field; `BrowserManager` becomes a thin session+tab owner. **Verify:** `npm test -- --run test/browser-tab-isolation.test.ts` green; full `npm run validate` green.
5. **[Core Logic — clear-cache flags]** — Add `clearAllCache({ olderThanMs })` and `clearCacheOlderThan(url, ms)` in `cache.ts`. Register a new `webfetch:clear-cache` command (or extend the existing one) with `--all`, `--older-than <duration>`, `--dry-run`. Document in the help output and README. **Verify:** `test/clear-cache-flags.test.ts` green.
6. **[Polish — docs]** — Write `docs/cache.md`. Add CHANGELOG "Added" / "Changed" entries. Update README with `--cache-ttl`, the new `webfetch-clear-cache` flags, and a link to `docs/cache.md`. Update `BACKLOG.md` with the 2026-06-06 review table. **Verify:** `npm run validate` green; `npm run build` clean; `npm pack --dry-run` shows the updated files.

### Milestone 2 — Markdown fidelity (Findings 2, 3, 4, 5)

7. **[Verification First — pin current image behaviour]** — Add `test/image-inlining.test.ts` against a Wikipedia fixture that pins the **current** broken behaviour (broken `[ref-N]` placeholders) so we have a regression point. **Verify:** the test fails against the new desired behaviour; this is the "before" snapshot.
8. **[Core Logic — inline images by default]** — In `extensions/markdown.ts`, rewrite `extractEmbeddedImages` to emit `![alt](absolute-url)` instead of `[ref-N]` references. Keep the extract-to-temp-file path as a non-default opt-in (e.g. `images: 'extract'`). Update `test/image-inlining.test.ts` to assert the new shape. **Verify:** the updated test passes; `test/cases/en-wikipedia-pi.md` and `en-wikipedia-apollo-11.md` snapshots updated.
9. **[Core Logic — denylist]** — Add the selector denylist (Finding 3 list) in both `cleanHtml` and `BrowserManager.extractHtml` cheerio pre-pass. Add `test/denylist.test.ts`. **Verify:** the test passes; `en-wikipedia-pi.md` snapshot no longer contains the fundraiser banner copy.
10. **[Core Logic — wikitable turndown rule]** — Add the `wikitables` rule in `turndown-config.ts`; register after `preserveCodeBlocks`. Add `test/table-wikitables.test.ts`. **Verify:** the new test passes; `en-wikipedia-pi.md` and `en-wikipedia-apollo-11.md` snapshots updated.
11. **[Core Logic — un-escape brackets]** — Add `unescapeMarkdownBrackets(markdown)` in `extensions/markdown.ts`; call it from `removeMarkdownAnchors` (or as a new post-processing pass). Add `test/markdown-unescape.test.ts`. **Verify:** the new test passes; regression snapshots remain green.
12. **[Polish]** — Refresh `test/cases/*` snapshots; update CHANGELOG "Changed" with a single entry covering M2; rerun `npm run test:regression` and `npm run report-url` against the live Wikipedia URLs to confirm the fundraiser banner is gone and tables are well-formed. **Verify:** `npm run validate` green; `npm run build` clean.

### Milestone 3 — Polish (Findings 7, 8, 9, 10, 11)

13. **[Verification First — provider name]** — Add `test/provider-name.test.ts` that pins `details.provider === 'default'` against the **current** code, so the test will fail when we rename. **Verify:** the test passes against unmodified code.
14. **[Core Logic — rename `default` → `browser` in user-facing surfaces]** — In `DefaultProvider.fetch`, set `providerName: 'browser'`. Update `gh-cli.ts` and `clawfetch.ts` to use their existing names. Document the user-facing enum in `extensions/types.ts` and `src/providers/types.ts`. Update `test/provider-name.test.ts` to assert the new value. **Verify:** the updated test passes; `test/fetch-service-github-hint.test.ts` and friends remain green.
15. **[Core Logic — `processedAs` widening]** — Widen the union to include `'html'` and `'static'`. In `DefaultProvider.fetch`, report `'spa'` for `waitFor === 'networkidle'` and `'html'` for `'domcontentloaded'`. The `staticFetch` path already reports `'fallback'`; rename to `'static'` for clarity (and update existing snapshots). Add `test/processed-as-labels.test.ts`. **Verify:** the new test passes; existing test snapshots updated.
16. **[Core Logic — sticky `staticOnly` warning]** — In `fetch-service.ts`, hoist the "have we shown the warning yet" flag to the process module level; replace the per-call `browserWarning` with a once-only content line and a sticky `details.staticOnly: true` flag. Add `test/static-only-warning.test.ts`. **Verify:** the new test passes; `test/cases/example-com.md` and `httpbin-org-html.md` snapshots updated.
17. **[Verification — Finding 9]** — Re-run `test/static-fetch-raw.test.ts` and `test/research-input-files.test.ts`; confirm the static path populates `rawContent` and `rawContentType` for HTML, markdown, and text/plain. Add a small **Finding 9 verification** entry to CHANGELOG / BACKLOG (no code change). **Verify:** tests pass.
18. **[Polish — README + CHANGELOG + final regression]** — Update README with the new `webfetch-clear-cache` flags, the `--cache-ttl` flag, the `staticOnly` flag, and the new `provider` enum. Add CHANGELOG entries for M3. Rerun `npm run test:regression` and `npm run report-url` against the live URLs in the review's test matrix. **Verify:** `npm run validate` green; `npm run build` clean; `npm pack --dry-run` clean.

## Definition of Done

- [x] Every acceptance criterion above is checked off.
- [x] Every test listed under "Tests needed" exists and passes.
- [x] `npm run validate` is green (typecheck + lint + full test suite).
- [x] `npm run build` is clean.
- [x] `npm pack --dry-run` lists the updated `dist/`, `extensions/`, `src/`, `docs/`, `README.md`, and `CHANGELOG.md` files.
- [x] `CHANGELOG.md` has three sections: "Added" (M1+M2+M3), "Changed" (M2 image default, M3 provider name, M3 `processedAs` rename), "Fixed" (M1 cache, M2 image refs, M2 banner, M2 tables, M2 brackets, M3 static warning).
- [x] `README.md` documents `--cache-ttl`, `cacheTtlMs`, the new `webfetch-clear-cache` flags, the `staticOnly` flag, and the `provider` enum.
- [x] `docs/cache.md` exists and covers the cache key, TTL default, denylisted hosts, on-disk path, and manual recovery.
- [x] `BACKLOG.md` has a 2026-06-06 review table mirroring the structure of the 2026-06-05 one, with each finding's status (Done / Verified) after v0.9.0 ships.
- [ ] One commit per milestone (three total), each with a conventional-commits subject. _(deferred to release-time)_
- [x] No `TODO` / `FIXME` / debug code left in the diff.
- [ ] Smoke test in a real pi session: re-run the review's test matrix (URLs 1, 2, 6, 11, 12) and confirm call #11 (the poisoned-cache case) now returns the correct Wikipedia content. _(deferred to a real pi session)_
