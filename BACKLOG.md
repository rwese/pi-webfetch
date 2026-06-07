# Project Backlog

## Completed ✅

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| #1 Fix Markdown-Escaping Tests | High | ✅ Done | Tests passing |
| #2 GhCliProvider Unit Tests | High | ✅ Done | Partial - reliable tests added |
| #3 Fallback Chain Tests | High | ✅ Done | 16 tests |
| #9 Real URL Regression Suite | High | ✅ Done | 10 cases, 41 tests |
| Add bot protection flag | - | ✅ Done | |
| Add Reddit RSS fast path | - | ✅ Done | |
| Add GitHub structured data | - | ✅ Done | |
| #8 Better Error Messages | Medium | ✅ Done | Resumable subagent sessions, resume commands, and notify surfaces |
| Address 2026-06-06 review bugs (3) | High | ✅ Done | [BUG-2026-06-06-JGCMZSET-YZOYE](./docs/bugs/BUG-2026-06-06-JGCMZSET-YZOYE.md) (silent fallback), [BUG-2026-06-06-JGCMZSNR-YZOYE](./docs/bugs/BUG-2026-06-06-JGCMZSNR-YZOYE.md) (DNS swallowed as 200), [BUG-2026-06-06-JGCMZSOB-YZOYE](./docs/bugs/BUG-2026-06-06-JGCMZSOB-YZOYE.md) (MathJax TeX leak). `providerError` surface + 5 s cap removal + Chromium net-error scan + MathJax denylist + `addMathJaxRule` turndown rule. 21 new tests across `provider-fallback-notify`, `browser-large-page`, `provider-net-error`, `fetch-service-net-error`, `wikipedia-math-cleanup`. Live matrix re-run is the only remaining acceptance criterion. |
| Browser session cleanup in tests | High | ✅ Done | Per-test `try/finally { close() }` in `browser-large-page`, `browser-tab-isolation`, `provider-net-error`. Process-level safety net in `test/helpers/agent-browser-cleanup.ts` (closes **only the current process's session** via `agent-browser close --session <our-name>`, never `--all`). Deterministic error-handling test in `providers.test.ts` (replaced real network call). 8 new tests in `agent-browser-cleanup.test.ts`. Pre-existing DNS flake in `providers.test.ts:253` is gone. |

---

## In Progress 🔄

| Task | Priority | Status | Plan |
|------|----------|--------|-------|
| #4 Resource Cleanup & Concurrency | High | 🔄 Planning | [PLAN_TASK4_RESOURCE_CLEANUP.md](./PLAN_TASK4_RESOURCE_CLEANUP.md) |

---

## Remaining Tasks 📋

### High Priority

| Task | Priority | Description |
|------|----------|-------------|
| #4 Resource Cleanup & Concurrency | High | Browser cleanup, concurrency fixes |
| #5 Consolidate URL Detection | Medium | Shared constants for SPA/binary detection |
| #6 GhCliProvider Complete | Medium | Add discussions, releases, commits, gists |
| #7 Re-authentication Check | Medium | TTL on auth, refresh method |

### Low Priority

| Task | Priority | Description |
|------|----------|-------------|
| #10 Retry Logic | Low | Exponential backoff |
| #11 Bot Protection | Low | FlareSolverr integration |
| #12 Security Hardening | Low | Token security, XSS prevention |
| #13 Dead Code Cleanup | Low | Remove unused code |
| #14 Provider Health Checks | Low | Monitor provider health |
| #15 Normalize Timeout Units | Low | Consistent timeouts |
| #16 Proxy Support | Low | HTTP proxy configuration |
| #17 User Agent Override | Low | Custom user agent |
| #18 Custom Headers | Low | Headers per request |
| #19 Documentation | Low | Update docs |

---

## Priority Order (Updated)

1. ~~#1 Fix tests~~ ✅
2. ~~#2 GhCliProvider tests~~ ✅
3. ~~#3 Fallback chain tests~~ ✅
4. ~~#9 Regression suite~~ ✅
5. **#4 Resource cleanup** ← CURRENT
6. #5 Consolidate detection
7. #6 GhCliProvider complete
8. ~~#8 Better errors~~ ✅
9. #12 Security hardening
10. #7 Re-auth check
... rest as time permits

---

## Quick Stats

- **Total tasks:** 22
- **Completed:** 8 (36%)
- **In Progress:** 1
- **Remaining:** 13

---

## Review Findings — 2026-06-05 (hands-on review of v0.7.0)

Surfaced by exercising the extension against `https://nope.at`,
`https://en.wikipedia.org/wiki/Playwright_(software)`, and
`https://github.com/microsoft/playwright` with the `webfetch` tool
and the local CLI (`node dist/extensions/cli.js …`).

| ID | Priority | Task | Notes |
|----|----------|------|-------|
| `2026-06-05-BXBE` | High | ✅ **Fixed: `webfetch` GitHub URL routes to `default` instead of `gh-cli`** | Provider selection now aggregates URL detection across available providers; authenticated GitHub URLs prefer `gh-cli`. Verified with `createProviderManager().selectProvider('https://github.com/microsoft/playwright') → gh-cli`. |
| `2026-06-05-BXBF` | Medium | ✅ **Fixed: Wikipedia article carries nav/footer noise** | MediaWiki navboxes, print footers, footer chrome, and category links are stripped in static and browser conversion paths; regression test added. |
| `2026-06-05-BXBG` | High | ✅ **Fixed: CLI `webfetch` with no flags covered** | Added compiled CLI regression for deterministic plain-text `webfetch <url>` output with empty stderr. |
| `2026-06-05-BXBH` | Medium | ✅ **Covered: Hybrid extraction selectors not unit-tested** | Existing `BrowserManager` extraction tests pin article/main/body fallback selection; provider routing regression added for GitHub selector path. |
| `2026-06-05-BXBI` | Low | ✅ **Fixed: `clear-cache` / `cache-stats` negative-path tests** | Added tests for uncached URL clear miss and stats after clear. |

### Why the gh-cli route did not win

Working theory (unverified — no code change yet):

1. `providers --json` reports `gh-cli.available: true`, so the binary is on `$PATH` and `--version` parses. That only proves the CLI is **installed**, not that it is **authenticated**.
2. The provider is also surfaced with `priority: 8` against `default: 10`. The AGENTS.md note ("prefer `gh-cli` when authenticated") implies the manager overrides priority on authenticated GitHub URLs, but the live output for `github.com/microsoft/playwright` shows `provider: default`. So either the override is not firing or `gh-cli.isAvailable()` returns `false` because `gh auth status` is non-zero in this environment.
3. `webfetch` with no `--provider` flag is what the user-facing path uses, so this is the default behaviour, not an opt-in miss.

Repro before changing code:

```sh
gh auth status
node dist/extensions/cli.js webfetch https://github.com/microsoft/playwright --json | jq '.provider,.method'
```

If `gh auth status` is non-zero → expected behaviour, document it in the README and add a test that asserts `default` wins when gh is not authenticated.

If `gh auth status` is OK → bug in `detectUrl` / manager selector. Fix in `extensions/fetch.ts` and add a regression test that mocks an authenticated `gh-cli.isAvailable()` and asserts the URL routes there.

---

## Notes

- Task #4 (Resource Cleanup) is flagged as critical for production use
- Concurrency issues could cause resource leaks under load
- Browser processes not being cleaned up properly

---

## GitHub fetch gaps

The GitHub fetch path (gh-cli provider + related surfaces) is intentionally
narrow today. The following gaps were surfaced during the review of
[`PLAN_GH_FETCH_OPTIONS.md`](./plans/PLAN_GH_FETCH_OPTIONS.md) and are
deferred to future slices. They are recorded here so the boundary of the
"issues + PR review threads via includeComments" feature is explicit.

| Gap | Notes |
|-----|-------|
| Git-protocol URLs | `git+https://...`, `ssh://git@github.com/...`, and bare `.git` URLs are not handled by the gh-cli provider. They fall through to the default provider and currently surface whatever HTML the host returns. |
| GitHub Enterprise hosts | Hosts other than `github.com` / `www.github.com` / `raw.githubusercontent.com` are not recognised by `parseGitHubUrl` / `detectGitHubUrl`. Enterprise customers need a host allowlist. |
| Recursive directory listings | `fetchDirectory` returns the top-level contents of a tree only. Cross-file link following and recursive expansion are out of scope. |
| PR diffs | The `gh pr view` fast path does not return diffs, checks, or file-level comments. The provider's `metadata` does not include them either. |
| "Open issues in repo" expansion | Fetching a repo does not expand its open issues; callers must walk each issue URL individually. |
| Size guard on `fetchFile` raw content | `fetchRawContent` is `curl`-based and has no size limit; large files could blow past the 100KB truncation step. |
| Detector disagreement on `raw.githubusercontent.com` | The manager-level selector bypasses gh-cli for raw URLs (so the static fetch wins), but the gh-cli provider still detects them. Document / align. |
| gh-cli as a hard requirement for GitHub fast path | The current chain prefers gh-cli and only falls back to clawfetch/default if it is unavailable. Some users without an authenticated `gh` want the default provider to win. |
| Auto-fetching of referenced issues/PRs | A fetched body that references another issue/PR is not auto-expanded. |
| Additional GitHub fetch options | Only `includeComments` is implemented today. Future options (`includeReviews`, `maxCommentDepth`, `includeReactions`) are additive on `GitHubFetchOptions`. |


---

## Review Findings — 2026-06-06 (hands-on review of v0.8.0)

Surfaced by exercising the extension against the test matrix in
[`docs/reviews/webfetch-review-2026-06-06.md`](./reviews/webfetch-review-2026-06-06.md).
Plan: [PLAN_WEBFETCH_REVIEW_FIXES.md](./plans/PLAN_WEBFETCH_REVIEW_FIXES.md).
Three milestones → v0.9.0.

| ID | Priority | Finding | Status | Milestone |
|----|----------|---------|--------|-----------|
| `2026-06-06-BXAA` | **BLOCKER** | Cache has no TTL and no content validation; a single bad write poisons the URL forever | ✅ Done (v0.9.0) | M1 |
| `2026-06-06-BXAB` | HIGH | Markdown image references render as broken `[ref-N]` placeholders | ⏳ Planned | M2 |
| `2026-06-06-BXAC` | HIGH | Wikipedia donation banner is captured as content | ⏳ Planned | M2 |
| `2026-06-06-BXAD` | MEDIUM | Wikipedia `wikitable` tables are mangled by column-header heuristic | ⏳ Planned | M2 |
| `2026-06-06-BXAE` | MEDIUM | Markdown post-processing mangles escaped brackets (`\[1\]` survives) | ⏳ Planned | M2 |
| `2026-06-06-BXAF` | MEDIUM | Default provider reuses a single browser tab → race conditions across fetches and across processes | ✅ Done (v0.9.0) | M1 |
| `2026-06-06-BXAG` | MEDIUM | `agent-browser` static-fallback warning shown on every call | ⏳ Planned | M3 |
| `2026-06-06-BXAH` | LOW | `details.provider === "default"` reads as "the GitHub fast path" | ⏳ Planned | M3 |
| `2026-06-06-BXAI` | LOW | Static-fallback cache hit discards the browser-side raw HTML | ✅ Verified in v0.8.0 (`test/static-fetch-raw.test.ts`); only CHANGELOG / BACKLOG note needed | M3 |
| `2026-06-06-BXAJ` | LOW | `Processed as: spa` for pages that are not SPAs | ⏳ Planned | M3 |
| `2026-06-06-BXAK` | LOW | `webfetch-clear-cache` is per-URL; no batch UX | ✅ Done (v0.9.0) | M3 |

### Why Finding 1 and Finding 6 land together (M1)

A bad cache write (Finding 1) is caused by a browser-tab race (Finding 6). With the per-tab fix in place, the race window closes; with the TTL + content-validation fix, a stray bad write cannot haunt the user past one hour. Either fix on its own is incomplete.

### Why Finding 9 is "verified, no code change"

`extensions/services/static-fetch.ts` already populates `rawContent` and `rawContentType` for HTML, markdown, and text/plain responses (the binary path intentionally does not). `test/static-fetch-raw.test.ts` covers all four paths. The M3 task is a final regression pass plus a CHANGELOG note so users know the behaviour is intentional.

### Smoke test after v0.9.0

Re-run the review's test matrix (URLs 1, 2, 6, 11, 12) in a real pi session. The critical assertion: call #11 (the poisoned-cache case) now returns the correct Wikipedia "Markdown" article, not the `earendil-works/pi` README. If the assertion fails, the cache TTL or content-validation step is broken; revert the M1 release.

## Done ✅

### M1 — Cache correctness (review findings 1, 6) [DONE 2026-06-06]

- [x] **M1.A — Cache TTL.** `isFresh(entry, ttlMs?)` in
  `extensions/cache.ts`; `DEFAULT_CACHE_TTL_MS = 1h`;
  `cacheTtlMs` threaded through CLI (`--cache-ttl <ms>`),
  MCP `webfetch` tool, pi extension tool, and
  `WebfetchDetails`. Pinned by `test/cache-ttl.test.ts`.
- [x] **M1.B — Cache content validation.**
  `validateCacheEntry(entry, requestedUrl)` cross-checks
  `finalUrl` / `pageTitle` / raw `<title>`. Mismatch →
  warn and skip persist. Pinned by
  `test/cache-content-validation.test.ts`.
- [x] **M1.C — Per-process browser session.** `BrowserManager`
  derives `AGENT_BROWSER_SESSION = ${os.hostname()}:${process.pid}`
  once in the constructor.
- [x] **M1.D — Per-fetch tab isolation.** `agent-browser
  tab new <url> --label webfetch-<uuid>`, close in
  `finally`. Pinned by
  `test/browser-tab-isolation.test.ts`.
- [x] **M1.E — `webfetch-clear-cache` batch UX.**
  `--all`, `--older-than <duration>`, `--dry-run`. Pinned
  by `test/clear-cache-flags.test.ts`.
- [x] **M1.F — Docs.** `docs/cache.md`; README and
  CHANGELOG updated.

### M2 — Markdown fidelity (review findings 2, 3, 4, 5) [DONE 2026-06-06]

- [x] **M2.A — Pin current image behaviour.** Pinned by
  `test/image-inlining.test.ts`.
- [x] **M2.B — Inline images by default.**
  `extractEmbeddedImages` keeps `![alt](url)` intact
  (opt-in `{ extract: true }` for pre-v0.9.0).
- [x] **M2.C — Selector denylist.** `cleanHtml` accepts
  `extraSelectors`; default provider threads a
  page-specific Wikipedia denylist. Pinned by
  `test/denylist.test.ts`.
- [x] **M2.D — Wikitable turndown rule.** Custom
  `wikitable` rule emits GFM tables. Pinned by
  `test/table-wikitables.test.ts`.
- [x] **M2.E — Un-escape brackets.** `unescapeBrackets`
  strips `\[` / `\]` outside code blocks. Pinned by
  `test/markdown-unescape.test.ts`.
- [x] **M2.F — Refresh snapshots / CHANGELOG.** All
  regression cases pass under the new behaviour.

### M3 — Polish (review findings 7, 8, 9, 10, 11) [DONE 2026-06-06]

- [x] **M3.A — Pin current provider name.**
  `DefaultProvider.name` stays `"default"`.
- [x] **M3.B — Rename `default` → `browser` in
  user-facing surfaces.** New `providerDisplayName` helper.
  Pinned by `test/provider-name.test.ts`.
- [x] **M3.C — Widen `processedAs` union.** New `html`,
  `static`, `cache`, `binary` values. Pinned by
  `test/processed-as-labels.test.ts`.
- [x] **M3.D — Sticky `staticOnly` warning.**
  `browserWarning` is set only on the static-fallback
  path. Pinned by `test/static-only-warning.test.ts`.
- [x] **M3.E — Finding 9 verification.** Already covered
  by `test/static-fetch-raw.test.ts`.
- [x] **M3.F — README + CHANGELOG + final regression.**
  README, CHANGELOG, and `docs/cache.md` updated;
  `npm run validate` green.
