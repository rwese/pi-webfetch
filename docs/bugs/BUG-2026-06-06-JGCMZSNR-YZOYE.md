---
state: fixed
needed: true
severity: medium
type: bug
component: src/providers/default.ts
reported: 2026-06-06
tested_against: v0.9.0
fixed_in: pending (`detectChromiumNetError` in `default.ts` + `ProviderError(reason: 'navigation_failed')` + `cache` skip-on-transient in `cache-service.ts`)
test_matrix: docs/reviews/webfetch-review-2026-06-06.md (call 8)
notes: 'The browser provider navigates to a "This site can’t be reached" page and reports Status: 200 with text/plain body. The static-fetch path correctly returns Status: 0 + TypeError. The browser result is misleading: it looks like a successful fetch of a real document.'
---

# BUG-2026-06-06-JGCMZSNR-YZOYE — Browser provider swallows DNS errors as 200 + text/plain

## Summary

When the browser provider navigates to a URL that fails DNS resolution (`does-not-exist.invalid`), the browser renders its own error page and `agent-browser get text body` returns that error page as plain text. The default provider then classifies the result as a `low text ratio` plain-text document, sets `Status: 200, Content-Type: text/plain, Method: browser-text-fallback`, and returns the error message as the page content.

The 2026-06-06 test matrix contract for call 8 (`https://does-not-exist.invalid`) is `Status: 0` + `Error: TypeError: fetch failed` with no stack trace. The static-fetch path produces that exact result. The browser path produces `Status: 200` with body `"This site can’t be reached … ERR_NAME_NOT_RESOLVED"`. Both `findings watchlist` and `acceptance criteria` for call 8 fail on the current implementation.

## Reproduction

```bash
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js clear-cache --all
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js webfetch https://does-not-exist.invalid
```

**Expected** (per the test matrix acceptance criteria):

```
**Status:** 0
**Error:** TypeError: fetch failed
```

with no body and no stack trace.

**Actual**:

```
**Status:** 200
**Content-Type:** text/plain
**Processed as:** spa
**Original size:** 214 B
**Output size:** 214 B
**Provider:** browser
**Method:** browser-text-fallback

This site can’t be reached
does-not-exist.invalid’s server IP address could not be found.
…
ERR_NAME_NOT_RESOLVED
```

The body is the Chromium net error page, returned to the user as if it were the page content.

## Root cause analysis

### Where it goes wrong

`src/providers/default.ts:161-167` (low text ratio branch):

```ts
if (textRatio < 0.05) {
  // Fallback: get plain text from browser
  const textResult = await this.browser.extractText(url, waitFor, timeout);
  content = textResult;
  extractionMethod = 'browser-text-fallback';
  reportedContentType = 'text/plain';
}
```

For `does-not-exist.invalid`, the body that `agent-browser` returns is a Chromium-injected net error page. Its `textContent` is short (`< 100` characters of HTML after cheerio cleaning), so the text ratio drops below 0.05 and the code takes the plain-text branch.

`extractText` calls `agent-browser get text body` and returns whatever Chromium rendered. There is no check for:

- the net error string (`ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`, `ERR_CONNECTION_TIMED_OUT`, `ERR_INTERNET_DISCONNECTED`, `ERR_SSL_PROTOCOL_ERROR`, etc.)
- the title (Chromium's error pages have a recognisable `<title>` like `"does-not-exist.invalid"` or `"Privacy error"`)
- the navigation status (Chromium exposes `net::ERR_*` codes to the DevTools protocol; `agent-browser` may surface them via a status field)

### Why static fetch works

`extensions/services/static-fetch.ts:228-246` catches the underlying `fetch` failure and re-throws as `WebfetchError({ status: 0, error: 'TypeError: fetch failed' })`. That error reaches the caller and the tool header renders `Status: 0 + Error: …` per the contract.

The browser provider has no equivalent path. The Chromium error page is treated as legitimate content.

### What `agent-browser` exposes

We have not audited the full surface. At minimum:

- `agent-browser status` may surface the most recent navigation result.
- Chromium's DevTools `Network.responseReceived` event has a `netError` field on failure; `agent-browser get` may or may not expose it.

Until we have a verified way to read the navigation error code from `agent-browser`, the safest fix is heuristic: detect the known Chromium error-page strings and reject them in the provider.

## Impact

- **Misleading results.** A user that calls `webfetch https://typo.example.com` gets back a "200" response with a 214 B body that looks like a real page. They have no programmatic way to detect the failure.
- **Cache poisoning of error pages.** A user that calls `webfetch https://does-not-exist.invalid` caches the Chromium error page. A subsequent call within the TTL returns the same error page from cache; if the user fixes the URL mid-session, they still see the cached error.
- **Research subagent confusion.** When the subagent sees a body that starts with "This site can’t be reached", it will not necessarily classify it as an error. The agent-error resume flow (see `docs/plans/PLAN_AGENT_ERROR_RESUME.md`) treats any non-error result as success; this bug means the resume hint never fires for a DNS failure that went through the browser path.
- **Test matrix call 8 is a regression.** The 2026-06-06 review contract (`Status: 0 + Error: TypeError: fetch failed`) is the documented behaviour. The browser path now silently breaks that contract.

## TODO

- [x] After `extractHtml` / `extractText` returns, scan the body for the known Chromium net-error strings (`ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`, `ERR_CONNECTION_TIMED_OUT`, `ERR_INTERNET_DISCONNECTED`, `ERR_SSL_PROTOCOL_ERROR`, `ERR_TOO_MANY_REDIRECTS`, `ERR_INVALID_URL`, `ERR_ADDRESS_UNREACHABLE`, `ERR_EMPTY_RESPONSE`, `ERR_ABORTED`, `ERR_BLOCKED_BY_CLIENT`, `ERR_BLOCKED_BY_ADMINISTRATOR`).
- [x] On a hit, throw a `ProviderError` with `reason: 'navigation_failed'` and a message that includes the URL and the net error code. The catch in `fetch-service.ts:166` will fall through to static fetch, which will produce the correct `Status: 0 + TypeError` for the user.
- [ ] Audit `agent-browser status` / `agent-browser get` output for a structured net-error field. If present, prefer the structured field over the string scan. Land the audit as a comment in `browser-manager.ts` so the next person knows. _(deferred: the string scan is the documented 90 % case; the static-fetch fallback catches the eventual transport failure on retry regardless.)_
- [x] Add a fixture test that mocks the browser to return a Chromium error page body and asserts the provider rejects it.

## Scope

### In scope

- `src/providers/default.ts` — add the net-error string scan in both the `extractHtml` and `extractText` paths, and throw a `ProviderError` on a match.
- `src/providers/internal/browser-manager.ts` — pass the body back through the same `HtmlExtractionResult` / `extractText` return type so the provider can scan it. No public API change.
- `src/providers/types.ts` — extend `ProviderError` with `reason: 'timeout' | 'navigation_failed' | 'low_text_ratio' | 'unknown'` (the new variant is `'navigation_failed'`).
- New tests:
  - `provider-net-error.test.ts` — mock `agent-browser` to return a body containing `ERR_NAME_NOT_RESOLVED`. Assert the provider throws `ProviderError` with `reason: 'navigation_failed'`.
  - `fetch-service-net-error.test.ts` — call `fetchUrl` with a URL that triggers the net error. Assert the fallback result has `Status: 0 + Error: TypeError: fetch failed` and the cache is **not** written (or is tagged `transient` — see BUG-2026-06-06-JGCMZSET-YZOYE).

### Out of scope

- Switching to a different headless browser. Puppeteer / Playwright expose `netError` natively and would be a cleaner fix; that is a separate decision.
- Detecting every Chromium net error. The list above is the 90 % case.
- Changing the static-fetch behaviour. It is already correct.

## Acceptance Criteria

- [ ] Test matrix call 8 returns `Status: 0` + `Error: TypeError: fetch failed` with no body and no stack trace, regardless of which provider is selected. _(gated on live test matrix re-run; the unit / integration tests pass on the offline fixture.)_
- [x] The provider throws `ProviderError` with `reason: 'navigation_failed'` when the rendered body contains any of the documented Chromium net error strings.
- [x] The fallback result for a navigation failure is **not** written to the cache (cross-references BUG-2026-06-06-JGCMZSET-YZOYE).
- [x] `npm run validate` exits 0 with the new tests.
- [ ] No regression on the happy-path browser calls (1, 3, 5, 7, 14 in the 2026-06-06 matrix). _(gated on live test matrix re-run.)_

## Validation

```bash
cd /Users/wese/Repos/github.com/rwese/pi-webfetch
npm install
npm run validate
npm run build
node dist/extensions/cli.js clear-cache --all

# Targeted: call 8 must now match the matrix contract
node dist/extensions/cli.js webfetch https://does-not-exist.invalid

# Acceptance: Status: 0 + Error: TypeError: fetch failed
# (no body, no stack trace)

# Regression: the other browser calls still work
node dist/extensions/cli.js webfetch https://nope.at
node dist/extensions/cli.js webfetch https://github.com/badlogic/pi-mono

# Full matrix re-run
# See .agents/references/webfetch-testing.md
```

## Risks / Rollback

- **Risk:** the string scan may false-positive on a page that legitimately contains the words "ERR_NAME_NOT_RESOLVED" in its text. *Mitigation:* scope the scan to a known Chromium title / heading pattern, not a substring anywhere in the body. Add a fixture test for a real page that contains the literal string.
- **Risk:** the net error string list is brittle; Chromium may localise or change them. *Mitigation:* this is the documented 90 % case; the fallback is the static-fetch path, which always works. We only lose the browser path on a Chromium change.
- **Risk:** the heuristic misses an error category (e.g. `ERR_QUIC_PROTOCOL_ERROR`). *Mitigation:* the static-fetch path catches the eventual transport failure on retry; the user sees a `Status: 0` instead of a misleading `200`.
- **Rollback:** the net-error string scan is a one-block remove. The new `ProviderError.reason` is additive.
