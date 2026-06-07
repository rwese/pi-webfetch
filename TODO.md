# TODO — Address docs/bugs

Three bug reports from the 2026-06-06 review need to be fixed:

1. **BUG-2026-06-06-JGCMZSET-YZOYE** (HIGH) — Browser provider silently falls back to static for large pages
2. **BUG-2026-06-06-JGCMZSNR-YZOYE** (MEDIUM) — Browser provider swallows DNS errors as `Status: 200` + text/plain
3. **BUG-2026-06-06-JGCMZSOB-YZOYE** (LOW) — Wikipedia MathJax TeX source leaks into markdown output

## Task order

### Phase 1: Foundation (shared by all 3 bugs)

- [x] **T1.1** Extend `ProviderError` with a `reason` field (`'timeout' | 'navigation_failed' | 'low_text_ratio' | 'unknown'`)
- [x] **T1.2** Add `providerError` field to `WebfetchDetails` in `extensions/types.ts`
- [x] **T1.3** Add `providerError` field to `ProviderFetchResult` in `src/providers/types.ts` (so providers can opt-in to surfacing the cause)

### Phase 2: BUG #1 — Browser provider silent fallback

- [x] **T2.1** Bump the per-subcommand `agent-browser get` timeout in `browser-manager.ts` from 5s to caller-supplied `timeout` (no cap)
- [x] **T2.2** In `default.ts`, throw `ProviderError` with `reason: 'timeout'` (or similar) when the browser times out
- [x] **T2.3** In `fetch-service.ts` `fetchUrl` / `webfetchSPA`: surface the `ProviderError` via `cacheNotify` / `details.notify` and a one-line warning in the content
- [x] **T2.4** In `cacheFetchResult`: skip cache write when the result's `providerError.reason` is `'timeout'` or `'navigation_failed'` (transient causes)
- [x] **T2.5** Add tests:
  - [x] `test/provider-fallback-notify.test.ts` — `ProviderError` is surfaced via `details.providerError` and a warning line
  - [x] `test/browser-large-page.test.ts` — `pickContentSource` does not bail at 5s
  - [x] `test/cache-no-poison-on-failure.test.ts` — fallback after transient error is not cached (covered in `provider-fallback-notify.test.ts` — skips the cache write on transient reason)

### Phase 3: BUG #2 — DNS errors swallowed as 200

- [x] **T3.1** Add Chromium net-error string scan in `default.ts` (after `extractHtml` and `extractText`)
- [x] **T3.2** On a hit, throw `ProviderError` with `reason: 'navigation_failed'`
- [x] **T3.3** Add tests:
  - [x] `test/provider-net-error.test.ts` — mock `agent-browser` to return a body containing `ERR_NAME_NOT_RESOLVED`, assert `ProviderError` with `reason: 'navigation_failed'`
  - [x] `test/fetch-service-net-error.test.ts` — full flow: navigation error → falls back to static, cache not written

### Phase 4: BUG #3 — MathJax TeX source leak

- [x] **T4.1** Add MathJax denylist selectors to `PAGE_DENYLIST_EXTRA` in `default.ts` (mwe-math-*, math annotation[encoding="TeX"], display:none inside mwe-math-*)
- [x] **T4.2** Update `cleanHtml` in `turndown-config.ts` to also process these (or rely on the existing extra-selectors merging path)
- [x] **T4.3** Add a MathJax-aware turndown rule that strips alt text + display-none fallback for the `<span class="mwe-math-*">` element but keeps the rendered `<img>`
- [x] **T4.4** Add fixture `test/fixtures/wikipedia-pi-math.html` (a small slice of the Pi article containing 1-2 formula spans)
- [x] **T4.5** Add `test/wikipedia-math-cleanup.test.ts` — assert zero `\displaystyle` / `\textstyle` / `\frac` matches and the rendered image link is preserved

### Phase 5: Final validation

- [x] **T5.1** Run `npm run validate` — must exit 0
- [x] **T5.2** Run `npm run build` — `dist/` must compile
- [x] **T5.3** Update `CHANGELOG.md` and `AGENTS.md` if behaviour changes affect them
- [x] **T5.4** Mark all three bug reports' TODO checkboxes done
- [ ] **T5.5** Create clean commits (one per bug or one combined per phase)
