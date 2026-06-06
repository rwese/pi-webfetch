# Webfetch testing reference

Reusable test plan for the `@rwese/pi-webfetch` `webfetch` tool. The
goal of this reference is to let any agent reproduce the 14-call live
test matrix from the 2026-06-06 review
([`docs/reviews/webfetch-review-2026-06-06.md`](../../../docs/reviews/webfetch-review-2026-06-06.md)),
catch the regressions in the findings list, and validate the fixes
once they land.

## When to use

- Before merging a change to `extensions/cache.ts`,
  `extensions/services/cache-service.ts`,
  `extensions/services/fetch-service.ts`,
  `extensions/services/static-fetch.ts`,
  `src/providers/internal/browser-manager.ts`,
  `src/providers/default.ts`, or
  `extensions/markdown.ts`.
- Before any release cut of `@rwese/pi-webfetch`.
- After a change to a provider (default / clawfetch / gh-cli) or
  to the markdown post-processor.
- Whenever the user reports "wrong content", "stale content", or
  "browser tab stuck" in an issue.

## Scope

### In scope

- Live calls against real, public URLs that exercise the full
  provider matrix (default browser, static fallback, gh-cli).
- The research subagent (the `--query` path) on at least one URL
  that has a researchable question.
- Cache hit / miss / poison scenarios.
- Error / network failure paths.

### Out of scope

- Unit tests under `test/` (run with `npm test` — already covered
  by the project's 422-test suite).
- MCP / CLI surface changes (covered by
  `test/mcp-tools.test.ts` and `test/cli.test.ts`).
- Performance benchmarks — the live test matrix is end-to-end,
  not a micro-benchmark.

## Pre-flight

Always run these first. If they fail, fix the environment before
running the test matrix.

```bash
cd /Users/wese/Repos/github.com/rwese/pi-webfetch
npm install
npm run validate         # typecheck + lint + 422 unit tests
npm run build            # dist/ must be current
npm pack --dry-run       # confirm the published contents are intact
```

Then check the runtime prerequisites:

```bash
which agent-browser      # optional, but unlocks the default provider
gh auth status           # optional, but unlocks the gh-cli provider
node --version           # must match engines in package.json
```

> If `agent-browser` is missing, the tool falls back to static
> fetch and warns on every call. That is fine for the static /
> error tests below; for tests 1, 2, 5, 6, 7, 11, 12 the
> `Method:` should read `browser-html-*`, not `fallback`.

Clear the cache once at the start of the session so tests start
clean:

```bash
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js webfetch-clear-cache --all
```

## Test matrix

The 14 calls below were the live test matrix for the 2026-06-06
review. Run them in the order shown — the order matters because
calls 6, 9, and 11 specifically exercise the cache-poisoning
scenario. For each call, record `URL`, `Status`, `Content-Type`,
`Processed as`, `Original size`, `Output size`, `Provider`,
`Method`, and the first ~200 chars of the body.

Use the `webfetch` tool exposed in the agent's own context for
calls 1-8, 11, 12, 14. Use the same tool with the `query`
parameter for calls 9, 10, 13.

| # | URL | Query | Expected provider / method | Watch for |
|---|-----|-------|-----------------------------|-----------|
| 1 | `https://nope.at` | — | `default` / `browser-html-body` | Tiny page (~133 B). 2 visible links. |
| 2 | `https://en.wikipedia.org/wiki/Web_browser` | — | `default` / `browser-html-main` | `Original size` 30-50 KB. Look for broken `[ref-N]` image refs (Finding #2). |
| 3 | `https://example.com` | — | static fallback | `Processed as: fallback` + warning block. Content must be the IANA example. |
| 4 | `https://raw.githubusercontent.com/octocat/Hello-World/master/README` | — | static / `text/plain` | Body must be exactly `Hello World!\n`. |
| 5 | `https://httpbin.org/html` | — | `default` / `browser-html-body` | Moby-Dick extract; no errors. |
| 6 | `https://en.wikipedia.org/wiki/Markdown` | — | `default` / `browser-html-article` | **MUST return the actual Wikipedia Markdown article.** If the body starts with `[![pi logo][ref-1]]` or matches the `earendil-works/pi` README, the cache / browser bug has regressed. |
| 7 | `https://github.com/badlogic/pi-mono` | — | `default` / `browser-html-article` | Redirects to `earendil-works/pi`. Body is the pi-mono README. Same byte size as call 6 **is the bug**; the URLs are different. |
| 8 | `https://does-not-exist.invalid` | — | `error` | `Status: 0`, `Error: TypeError: fetch failed`. No stack trace. |
| 9 | call #6 with `--query "What is the main syntax for lists and code blocks in Markdown?"` | yes | research subagent | Subagent should produce a cited answer that names `*` / `-` / `1.` markers. The research subagent should NOT just echo the (potentially poisoned) cache. |
| 10 | call #1 with `--query "What is the blog's main topic and latest post title?"` | yes | research subagent | Concise, correct. "Welcome to My Blog" + "nov 2025". |
| 11 | call #6, plain, third invocation | — | `default` / `browser-html-article` | **MUST match call #6.** If the cache is poisoned, this returns the same wrong content as the previous calls. |
| 12 | `https://en.wikipedia.org/wiki/Pi` | — | `default` / `browser-html-main` | `Original size` 200-300 KB, `Output size` 100 KB (truncated). Body must include the actual Pi article, not the fundraiser banner (Finding #3). |
| 13 | call #12 with `--query "What is the mathematical constant pi?"` | yes | research subagent | Must say "approximately 3.14159" + "ratio of circumference to diameter". |
| 14 | `https://github.com/earendil-works/pi/issues/1` | — | `gh-cli` / `gh-issue-view` | Clean, structured, with `> Tip: pass includeComments: true (CLI: --include-comments)` at the bottom. |

## Findings watchlist

The review surfaced 11 findings. Use this list as a regression
checklist — every finding has a one-line test for it.

| # | Finding | How to verify in the test matrix |
|---|---------|----------------------------------|
| 1 | Cache has no TTL + no content validation | Calls 6, 7, 11 — same URL must return different content from the redirected github URL. With TTL + verification, a poisoned entry should be evicted or rejected. |
| 2 | Broken `[ref-N]` image refs | Calls 2, 12 — `rg '\]\[ref-[0-9]+\]\]' <result>` must return zero hits once Finding #2 is fixed. |
| 3 | Wikipedia donation banner is content | Call 12 — first 50 lines of output must be article body, not "€2,75" copy. |
| 4 | Wikipedia tables mangled | Call 2 — market-share table must render as a markdown table (or be dropped cleanly), not as a single-column mess. |
| 5 | Escaped `\[` / `\]` leak | Call 2 — `rg '\\\[' <result>` must return zero hits in article body. |
| 6 | Default provider reuses a single browser tab | After Finding #6 is fixed, calls 1, 5, 6 (different hosts) must each navigate to a fresh tab. Add a debug log in `BrowserManager` and confirm one `agent-browser tab open` per `extractHtml` call. |
| 7 | Static-fallback warning fires on every call | Repeat call 3 ten times — warning should appear at most once per session. |
| 8 | `default` provider name is confusing | After Finding #8, `details.provider` should be `browser` for the default path, not `default`. |
| 9 | Static fallback discards `rawContent` | Repeat call 3 with `--query` after a static-only fetch. The research subagent work dir should contain an `input_raw.html`, not just `input.md`. |
| 10 | `spa` vs `html` vs `static` | Call 4 should report `Processed as: html` (or a non-`spa` value) once the rename lands. |
| 11 | `webfetch-clear-cache` help text | `node dist/extensions/cli.js webfetch-clear-cache --help` should mention `--all`, `--older-than`, `--dry-run`. |

## Acceptance criteria

A test run is **passing** when all of the following hold:

- [ ] Pre-flight commands all exit 0.
- [ ] Calls 1, 2, 5, 6, 7, 11, 12 return content that matches the
  URL (no cross-contamination between different hosts).
- [ ] Call 3 reports `Processed as: fallback` exactly once for
  the session, not once per invocation.
- [ ] Call 4 returns the literal `Hello World!` text.
- [ ] Call 8 returns `Status: 0` + `Error: TypeError: fetch failed`
  with no stack trace.
- [ ] Calls 9, 10, 13 (research subagent) return concise answers
  that cite the source URL, not the cached body.
- [ ] Call 14 returns structured GitHub-issue output with the
  `> Tip: pass includeComments: true` discovery hint.
- [ ] Findings watchlist: every row above is either passing or
  explicitly marked as known-failing with a tracking issue.

## Validation

```bash
# Build / unit gate (always)
npm run validate
npm run build

# Live test matrix (manual, in a pi session)
# Re-run the 14-call matrix above. Capture the full output to a
# file per call for diffing between releases.

# Cache utilities
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js webfetch-clear-cache --all
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js cache-stats

# Provider check
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js providers
```

## Risks / Rollback

- **Risk:** a live URL changes its structure between runs and the
  expected markers in the matrix no longer match. *Mitigation:*
  the matrix is intentionally small and the expected markers are
  "stable" properties (the Wikipedia Pi article body has
  mentioned "Archimedes" since 2001). If a marker disappears,
  update the matrix; do not change the test plan to mask a real
  regression.
- **Risk:** calls 9, 10, 13 are slow (≥3 minutes each by default
  budget `DEFAULT_PI_AGENT_TIMEOUT_MS`). *Mitigation:* the matrix
  is the slow path. Keep it out of CI; gate it on manual review
  and on a long-running job.
- **Risk:** `agent-browser` not installed in the test environment
  silently downgrades calls 1, 2, 5, 6, 7, 11, 12 to static
  fallback, masking browser-state regressions. *Mitigation:*
  pre-flight checks `which agent-browser` and fails the run
  loudly if absent.
- **Rollback:** this reference does not deploy code. If the
  findings it tracks regress, revert the commit that introduced
  the regression; do not edit the test matrix to "make it pass".

## History

- 2026-06-06 — initial 14-call matrix, derived from the
  [`docs/reviews/webfetch-review-2026-06-06.md`](../../../docs/reviews/webfetch-review-2026-06-06.md)
  review session.
