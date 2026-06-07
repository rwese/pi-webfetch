---
state: fixed
needed: true
severity: high
type: bug
component: src/providers/default.ts
reported: 2026-06-06
tested_against: v0.9.0
fixed_in: pending (cap removal + `providerError` surface + transient-cache-skip in `fetch-service.ts` / `default.ts` / `cache-service.ts`)
test_matrix: docs/reviews/webfetch-review-2026-06-06.md (calls 2, 6, 11, 12)
notes: 'Browser provider silently falls back to static fetch for any page whose extraction takes longer than the per-subcommand `agent-browser get` timeout. Cache then stores the fallback result and subsequent calls hit the cache, masking the regression.'
---

# BUG-2026-06-06-JGCMZSET-YZOYE — Browser provider silently falls back to static for large pages

## Summary

The default (browser) provider fails silently on any Wikipedia-class page (>~200 KB rendered HTML), and the catch in `fetch-service.ts` falls through to `staticFetch`. The end user gets a `200` with the correct Wikipedia article but no signal that the browser path was abandoned. The fallback result is then cached under the same cache key, so subsequent calls hit the cache and the user never sees a recovery.

Affected test-matrix calls (2026-06-06 live run): **2, 6, 11, 12** — all return `Processed as: fallback` with no `Provider:` / `Method:` line, even though `agent-browser --version` returns `0.26.0` and the browser successfully serves calls 1, 3, 5, 7, 14.

The root cause is a `try { … } catch { /* fall through */ }` block in `extensions/services/fetch-service.ts` that swallows every provider error, combined with no `console.warn` / `notify` call to surface the failure to the user.

## Reproduction

```bash
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js clear-cache --all
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js webfetch https://en.wikipedia.org/wiki/Markdown
```

**Expected** (per the design intent of having a browser provider):

- `Processed as: spa` or `Processed as: html`
- `Provider: browser`
- `Method: browser-html-article` or `browser-html-main`
- Output markdown containing only the article body, no broken image refs, no `\[` / `\]` leaks

**Actual**:

```
**Processed as:** fallback
**Original size:** 204.2 KB
**Output size:** 37.6 KB
```

No `Provider:` / `Method:` line, no warning, no notify. The same call 30 s later is a cache hit and the user has no way to know the browser was bypassed.

## Root cause analysis

### Code path

1. `extensions/services/fetch-service.ts:152` (`fetchUrl`) enters the `shouldUseProvider` branch for HTML content.
2. `extensions/services/fetch-service.ts:155-167` calls `manager.fetch(url, config)` and wraps it in `try { … } catch { /* fall through */ }`.
3. `src/providers/default.ts:130-136` calls `await this.browser.extractHtml(url, waitFor, timeout)` with `timeout = config?.timeout || 30000` (30 s).
4. `src/providers/internal/browser-manager.ts:128-141` (`extractHtml`) opens a tab, waits for `networkidle`, then calls `runInTab` → `agent-browser get html body` with a 30 s timeout.
5. The 5 s-capped `pickContentSource` retry loop (`browser-manager.ts:226`) makes three sequential `agent-browser get html article|main|body` calls. For Wikipedia each call extracts the entire article DOM; the 5 s cap is hit, the retry falls through to `body`, the body extraction then runs into the 30 s ceiling, and the whole call throws.

### Why it falls through silently

`fetch-service.ts:166` catches the throw and runs `// Fallback to static fetch` with no `console.warn`, no `writeNotify`, no `_meta.details.notify`. The user cannot tell that:

- the browser provider was attempted
- the attempt timed out
- the response is the static-fetch fallback, not the browser result they paid for

### Why caching masks the issue

The fallback result is written to cache by `cacheFetchResult` (`fetch-service.ts:170-175`) under the same key the browser result would have used. Subsequent calls within the TTL (`60 * 60 * 1000` ms = 1 h by default) hit the cache and never re-attempt the browser. The user has no recovery path short of `clear-cache --all` or `--url`.

## Impact

- **Users paying for the browser path** (the whole point of having a browser provider) get static-fetch output. The Markdown conversion is the same cheerio+turndown path so the output *looks* fine, but JavaScript-rendered content is silently lost.
- **Finding #6 ("Default provider reuses a single browser tab")** was supposed to be fixed in v0.9.0 by allocating a fresh tab per fetch. The new bug makes that fix invisible: a fresh tab is allocated, fails on the 5 s `pickContentSource` retry loop, and the user sees a fallback. They have no way to know the fix is in place.
- **Cache poisoning risk is reintroduced** if the user retries the URL after a transient browser failure: the cache holds a partial result that may not match what a subsequent browser attempt would produce. The title-validation hook from Finding #1 only fires on the persistence path, not on the retrieval path.

## TODO

- [x] Add a `console.warn` (or `writeNotify(options, …, 'warning')` on the extension / `console.error` on the CLI / `_meta.details.notify` on the MCP) in the `catch` at `extensions/services/fetch-service.ts:166`. Message: `browser provider failed for <url>: <error.message>; falling back to static fetch`.
- [x] On the extension tool path, the `notify` should also surface in the TUI as a yellow notification, not just a stderr line.
- [x] Bump the per-subcommand `agent-browser get` timeout in `browser-manager.ts:226` from 5 s to 30 s for the `pickContentSource` retry, or remove the cap entirely and rely on the caller-supplied `timeout`.
- [x] Add a `reason` field to `ProviderError` and surface it on the `details` of the fallback result, so users can tell *why* the browser was abandoned (timeout vs. crash vs. navigation).
- [x] Do **not** cache the fallback result when the browser errored out with a transient-looking cause (timeout, navigation failure, ECONNRESET). Cache the original provider error in `details.providerError` and let the next call re-attempt.

## Scope

### In scope

- `extensions/services/fetch-service.ts` — surface the catch via `writeNotify` / `console.warn`.
- `src/providers/internal/browser-manager.ts` — remove or raise the 5 s cap on `pickContentSource`; ensure `extractHtml` is the only timeout owner.
- `src/providers/default.ts` — propagate a `reason` field on the `ProviderError`.
- `src/providers/types.ts` — extend `WebfetchDetails` with optional `providerError: { provider, reason, message }` so the fallback result can carry the cause.
- New tests under `test/`:
  - `provider-fallback-notify.test.ts` — assert `details.providerError.provider === 'browser'` and `details.providerError.reason === 'timeout'` when the browser throws `ETIMEDOUT`.
  - `browser-large-page.test.ts` — fetch a fixture page > 200 KB and assert `pickContentSource` does not bail at 5 s.
  - `cache-no-poison-on-failure.test.ts` — assert that a fallback produced after a provider error is not written to the cache (or is tagged with a `transient: true` flag the next call invalidates).

### Out of scope

- Changing the default 30 s `timeout` in `ProviderConfig`. The 30 s default is a separate decision.
- Adding retry / backoff logic for the browser path. That belongs in a follow-up plan.
- Replacing `agent-browser` with a different headless browser.

## Acceptance Criteria

- [x] When the browser provider fails, the call result includes `details.providerError = { provider: 'browser', reason: <classified reason>, message: <raw> }` and the user sees a one-line warning in the tool output.
- [x] When the browser provider times out, the cache is **not** written for the fallback result, and a subsequent call within the same TTL re-attempts the browser.
- [x] `pickContentSource` does not bail at 5 s for the article / main / body sequence; the per-`get` timeout is at least the caller-supplied `timeout` (30 s default).
- [ ] The 2026-06-06 test matrix call 6 (`https://en.wikipedia.org/wiki/Markdown`) and call 12 (`https://en.wikipedia.org/wiki/Pi`) return `Provider: browser, Method: browser-html-article` instead of `Processed as: fallback`. _(gated on live test matrix re-run; the unit / integration tests pass on the offline fixture.)_
- [x] `npm run validate` exits 0 with the new tests.
- [ ] No regression on calls 1, 3, 5, 7, 14 (which currently use the browser provider correctly). _(gated on live test matrix re-run.)_

## Validation

```bash
# Pre-flight
cd /Users/wese/Repos/github.com/rwese/pi-webfetch
npm install
npm run validate
npm run build
node dist/extensions/cli.js clear-cache --all

# Targeted re-run of the failing calls
node dist/extensions/cli.js webfetch https://en.wikipedia.org/wiki/Markdown
node dist/extensions/cli.js webfetch https://en.wikipedia.org/wiki/Pi

# Acceptance: both calls now report Provider: browser
rg "Provider: browser" /tmp/wf-call6.txt /tmp/wf-call12.txt

# Full matrix re-run (calls 1-8, 11, 12, 14)
# See .agents/references/webfetch-testing.md

# Regression suite
npm run report-url
npm test
```

## Risks / Rollback

- **Risk:** the `providerError` field is a public-API addition. Consumers that destructure `WebfetchDetails` strictly may need to add it. *Mitigation:* the field is `optional: true` and adds no required keys.
- **Risk:** removing the 5 s cap on `pickContentSource` makes large Wikipedia pages 10-15 s slower end-to-end. *Mitigation:* the cap is per-`get`; the global timeout is still 30 s. If the global timeout is the binding constraint, the call fails the same way as today.
- **Risk:** skipping the cache write on transient failure means every retry re-runs the browser. *Mitigation:* the retry is what the user wants when the previous attempt errored. The next plan can add a "circuit breaker" if the retry is abusive.
- **Rollback:** the catch at `fetch-service.ts:166` is a one-line restore to silence. The 5 s cap is a one-line restore. The `providerError` field is purely additive and can stay.
