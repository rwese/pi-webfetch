# `webfetch` review — 2026-06-06

A hands-on review of the `webfetch` tool shipped by `@rwese/pi-webfetch`
v0.8.0. All findings come from live calls made against the published
tool on 2026-06-06 from a pi session. No fixtures, no mocks — every URL
in the [Test matrix](#test-matrix) below was hit for real.

## TL;DR

The tool is genuinely useful and covers a lot of ground (browser
rendering, plain text, binaries, GitHub fast path, research subagent).
For the happy path of "fetch a simple HTML page, give me markdown" it
is fast, well-formatted, and friendly to subsequent LLM context.

There is **one blocking correctness bug** — a stale cache entry can
permanently pin the wrong content to a URL — and several smaller
quality issues around markdown fidelity, image references, and a
missing cache TTL. The research subagent (`--query`) is excellent and
even self-detected the cache poisoning during this review.

Findings are ordered by severity; each one links to the source file
that owns the fix.

## Test matrix

| # | URL | Provider | Method | Notes |
|---|-----|----------|--------|-------|
| 1 | `https://nope.at` | default | `browser-html-body` | 133 B blog, clean output. Cache hit from "1 day ago". |
| 2 | `https://en.wikipedia.org/wiki/Web_browser` | default | `browser-html-main` | 38 KB → 36 KB. Image refs rendered as broken `[ref-N]` placeholders. |
| 3 | `https://example.com` | static | n/a (no browser available) | Auto-fallback warning shown, content correct. |
| 4 | `https://raw.githubusercontent.com/octocat/Hello-World/master/README` | static | n/a (text/plain) | 13 B returned as-is. |
| 5 | `https://httpbin.org/html` | default | `browser-html-body` | Hemingway / Moby-Dick extract, no issues. |
| 6 | `https://en.wikipedia.org/wiki/Markdown` | default | `browser-html-article` | **5.9 KB → 5.4 KB — returned the wrong page (pi-mono README).** |
| 7 | `https://github.com/badlogic/pi-mono` | default | `browser-html-article` | Same 5.9 KB → 5.4 KB output, **the real pi-mono README**. |
| 8 | `https://does-not-exist.invalid` | — | `error` | `Status: 0`, `Error: TypeError: fetch failed`. Clean. |
| 9 | `#6` with `--query "What is the main syntax for lists and code blocks in Markdown?"` | default | research subagent | **Subagent noticed cache mismatch and re-fetched.** Returned a correct, well-cited answer. |
| 10 | `#1` with `--query "What is the blog's main topic and latest post title?"` | default | research subagent | Concise, correct. |
| 11 | `#6` plain (third call) | default | `browser-html-article` | **Still serving the wrong content — cache is permanently poisoned.** |
| 12 | `https://en.wikipedia.org/wiki/Pi` | default | `browser-html-main` | 241 KB → 100 KB (truncated). Correct content, but includes a giant donation banner. |
| 13 | `#12` with `--query` | default | research subagent | Concise, correct. |
| 14 | `https://github.com/earendil-works/pi/issues/1` | gh-cli | `gh-issue-view` | Clean, structured, with `> Tip:` hint for `includeComments`. |

The `gh-cli` provider (#14) is by far the cleanest result. The
research subagent (#9, #10, #13) is the most pleasant UX.

## Findings

### 1. [BLOCKER] Cache has no TTL and no content validation — a single bad write poisons the URL forever

**What happened:** Call #6 (`https://en.wikipedia.org/wiki/Markdown`)
returned the body of the `earendil-works/pi` (formerly
`badlogic/pi-mono`) GitHub README. Bytes-for-bytes identical
(`5.9 KB → 5.4 KB`) to the github fetch in call #7. Call #11,
hours of conversation later, still returned the same wrong content.
The subagent in call #9 explicitly noted: *"The cached `input.md` /
`input_raw.html` were for the wrong URL… I re-fetched the actual
`https://en.wikipedia.org/wiki/Markdown` and used that."*

**Root cause:**
[`extensions/cache.ts`](../../extensions/cache.ts) keys entries by
`sha256(url)[:32]`, writes them to `<tmpdir>/pi-webfetch-cache/`, and
**never expires them**. The write side
([`cache-service.ts::buildCacheEntry`](../../extensions/services/cache-service.ts))
trusts whatever the provider returns. There is no verification that
the returned HTML actually corresponds to the requested URL (e.g. by
checking the `<title>` / `og:url` / final redirect target), and there
is no time-based eviction.

**Why one bad write happens at all (suspected):**
[`src/providers/internal/browser-manager.ts`](../../src/providers/internal/browser-manager.ts)
keeps a single `agent-browser` tab alive across calls and only
navigates when `this.currentUrl !== url`. If a navigation is in
flight (or `agent-browser open` returns before the new page is
committed) and a second fetch reaches the same `BrowserManager`, the
extraction step can pull HTML from the previous page. The
`BrowserMutex` in the same file serialises provider-level calls but
**the per-process browser is a global resource on the host**, so two
concurrent webfetch processes (e.g. parallel tool calls) can race on
the same `agent-browser` instance. The proposed fix
([Finding 6](#6-medium-default-provider-reuses-a-single-browser-tab))
is to use one tab per fetch.

**Required fixes (in order):**

1. **Add a TTL to the cache.** A 1-hour default with a `cacheTtlMs`
   option on `fetchUrl` / `webfetchSPA` is enough to stop "1 day
   ago" entries from haunting current sessions.
2. **Verify the cache write.** Before persisting, compare
   `result.finalUrl` (when the provider exposes it) or the page
   `<title>` against the requested URL. Reject the cache write on
   mismatch and log a warning; re-throw the original provider
   error so the caller retries.
3. **Expose `webfetch-clear-cache --all` and `--older-than <ms>`**
   so the user can self-recover without nuking the whole cache
   directory.
4. **Document the cache key** (URL + provider options, sha256,
   `<tmpdir>/pi-webfetch-cache/`) in `docs/` so users can `rm` the
   offending file by hand when this regresses.

### 2. [HIGH] Markdown image references render as broken `[ref-N]` placeholders

Call #2 (Wikipedia "Web browser") and call #12 (Wikipedia "Pi")
contain image references like:

```markdown
[![Featured article][ref-1]](...)
[![Page semi-protected][ref-2]](...)
[![Image2][ref-2]](...)
```

The `[ref-N]` syntax is the standard markdown image-reference
shortcut, but the corresponding `[ref-N]: <url>` definitions are
stripped by `turndown` (or never extracted from the HTML in the
first place). The result is a sea of broken image links that pollute
the LLM context and confuse downstream rendering.

**Fix:** in
[`extensions/markdown.ts::removeMarkdownAnchors`](../../extensions/markdown.ts)
and the `turndown` config
([`src/providers/internal/turndown-config.ts`](../../src/providers/internal/turndown-config.ts)),
decide one of two strategies and apply it consistently:

- **Inlining:** resolve every image to `![alt](absolute-url)` so the
  markdown is self-contained.
- **Stripping:** drop `<img>` elements whose `alt` is empty and
  keep the ones with meaningful alt text inlined.

Either way, do **not** emit `[ref-N]` placeholders without their
definitions.

### 3. [HIGH] Wikipedia donation banner is captured as content

Call #12 returned 241 KB of which 100 KB made it into the result;
the first ~70 KB of the output is the Wikimedia fundraiser banner
(forms, payment-method dropdowns, "you can give €2,75" copy). The
article body is correct but buried under an enormous "please donate"
UI.

**Fix:** the default provider's selector cascade (article → main →
body) is the right shape; add a denylist of selectors that are
known noise:

- `[class*="fundraiser"], [class*="donate"], [id*="donate"]`
- `[role="banner"]`, `[role="dialog"]` modals
- `<aside>` content not specifically marked `<aside role="note">`

Apply the denylist in
[`src/providers/internal/browser-manager.ts::extractHtml`](../../src/providers/internal/browser-manager.ts)
before handing the HTML to cheerio / turndown.

### 4. [MEDIUM] Wikipedia tables are mangled by the table-column header heuristic

Call #2's market-share table came out as:

```
Web browser
Market share
showReference

Chrome
~63%
[ref-2][ref-40]
```

The column headers (Browser, Market share, Sources) are split into
rows and the table loses all structure. This is a cheerio /
turndown table issue specific to Wikipedia's `wikitable` class.

**Fix:** add a turndown rule that detects `wikitable` and emits a
pipe-table with the first `<tr>` as the header row, or add a
post-processing pass in
[`extensions/markdown.ts`](../../extensions/markdown.ts) that
re-builds pipe tables from `<th>`-headed `<tr>` rows.

### 5. [MEDIUM] Markdown post-processing can mangle escaped brackets

In the same Wikipedia "Web browser" result, escaped sequence
citations render as `[\[1\]](#cite_note-1)`. The `\[` / `\]` escapes
survive into the final markdown, which is not portable to most
renderers and looks like a typo to a human reader.

**Fix:** in
[`extensions/markdown.ts::removeMarkdownAnchors`](../../extensions/markdown.ts),
un-escape `\[` / `\]` / `\*` etc. in the post-processing pass.

### 6. [MEDIUM] Default provider reuses a single browser tab

As called out in Finding 1, the suspected root cause is
[`src/providers/internal/browser-manager.ts`](../../src/providers/internal/browser-manager.ts)
navigating the same `agent-browser` tab across requests. The current
"remember `currentUrl`, skip `agent-browser open` if it matches"
optimisation saves a few hundred ms on repeat fetches of the same
URL, but introduces two problems:

- If `agent-browser open` returns before the new page has committed,
  the subsequent `wait --load networkidle` can settle on the wrong
  document.
- Two concurrent webfetch processes on the host (e.g. parallel tool
  calls) race on the same global `agent-browser` instance and can
  end up extracting each other's HTML.

**Proposed fix:** use one tab per fetch.

- `extractHtml` always calls `agent-browser open <url>` with a
  unique `--tab` (or `--profile` / `--user-data-dir`) so each fetch
  has isolated state.
- After `get html <selector>`, the wrapper calls `agent-browser tab
  close --id <id>` in a `finally` to release the resource.
- The `currentUrl` / idle timer logic goes away. The
  `BrowserManager` becomes a stateless executor.

Trade-off: ~200-400 ms slower per call on a hot path. Worth it for
correctness — and the cache already removes most repeat calls.

### 7. [MEDIUM] `agent-browser` is required even for sites that don't need it

Call #3 (`https://example.com`) showed
`Processed as: fallback` and the warning
`> ⚠️ Using static fetch (no browser provider available)`, because
`agent-browser` was not on `PATH` for that session. The fallback
worked, but the warning is now hard-coded into the user-visible
output. A user who has chosen to run without `agent-browser` does
not need to be told on every fetch.

**Fix:** in
[`extensions/services/fetch-service.ts::fetchUrl`](../../extensions/services/fetch-service.ts),
only inject the warning into `content` (or `details`) the **first**
time per session, and surface the static-only mode via a single
`details.staticOnly: true` flag for programmatic consumers.

### 8. [LOW] The "default" provider name in `details.provider` is confusing

When the user does not pass `--provider`, `details.provider` is
still `"default"`, which reads as "the default GitHub fast path" to
someone skimming. Consider `"browser"` (matching the
`browser-html-*` `extractionMethod` namespace) and reserve
`"default"` for "auto-select".

### 9. [LOW] Static-fallback cache hit discards the browser-side raw HTML

When the browser is unavailable, the static fetch returns a
processed `FetchResult` with no `rawContent`. The cache then has no
`rawContent` for that URL, so a later research subagent that hits
the cache cannot write `input_raw.<ext>`. Static fetch in
[`extensions/services/static-fetch.ts`](../../extensions/services/static-fetch.ts)
should populate `rawContent` with the original response body and
`rawContentType` with the upstream `Content-Type` so the cache is
useful in research mode regardless of provider availability.

### 10. [LOW] `Processed as: spa` for pages that are not SPAs

`nope.at` and `httpbin.org/html` are plain server-rendered HTML and
have no JS to wait for, but they are still reported as
`Processed as: spa`. This is technically correct (the
extraction path went through the SPA provider), but it confuses
users. Differentiate:

- `spa` — used a real browser, network-idle wait.
- `html` — used a real browser, domcontentloaded wait.
- `static` — used HTTP only.

### 11. [LOW] `webfetch-clear-cache` is per-URL; no batch UX

[`extensions/commands/webfetch-cache-command.ts`](../../extensions/commands/webfetch-cache-command.ts)
already supports `--all`, but the help text does not show it. Add
`--all`, `--older-than <duration>`, and `--dry-run` flags to the
help and the README.

## What works really well

- **Research subagent** — calls #9, #10, #13. Streaming `text_delta`
  feedback (here reduced to a single response) is genuinely nice.
  The subagent noticed the cache-poisoning bug and self-recovered;
  that is the right behaviour.
- **`gh-cli` provider** — call #14. Clean, structured, with the
  `> Tip: pass includeComments: true` discovery hint surfaced in both
  the content and `details.githubHint`. Best in class.
- **Error handling** — call #8. `Status: 0`, plain error string, no
  stack trace noise.
- **Auto-fallback** — call #3. When the browser is not available,
  static fetch takes over without an exception.
- **Method transparency** — every result carries
  `Method: browser-html-main` / `browser-html-article` /
  `gh-issue-view` / etc. This is gold for debugging.

## Suggested next steps

1. **Land the cache TTL + content verification** (Finding 1) before
   the next release. Without it, a single race condition can make
   a URL permanently unusable for that user.
2. **Add the per-fetch browser tab** (Finding 6) in the same
   release; the two are tightly coupled.
3. **Add regression test cases for both** in
   [`test/cases/`](../../test/cases/) — a poisoned-cache fixture
   and a concurrent-fetch fixture.
4. **Triage Findings 2-5** as a "markdown fidelity" milestone:
   image refs, fundraiser banner denylist, table rebuild, bracket
   un-escape. These are all `extensions/markdown.ts` /
   `src/providers/internal/turndown-config.ts` work.
5. **Findings 7-11** are cleanup; bundle into a single polish
   release.

## File / line index

| Finding | Primary file | Secondary file |
|---------|-------------|----------------|
| 1 — Cache TTL / validation | `extensions/cache.ts` | `extensions/services/cache-service.ts` |
| 2 — Broken `[ref-N]` images | `extensions/markdown.ts` | `src/providers/internal/turndown-config.ts` |
| 3 — Fundraiser banner noise | `src/providers/internal/browser-manager.ts` | `src/providers/default.ts` |
| 4 — Table mangling | `extensions/markdown.ts` | `src/providers/internal/turndown-config.ts` |
| 5 — Escaped brackets | `extensions/markdown.ts` | — |
| 6 — Single shared tab | `src/providers/internal/browser-manager.ts` | `src/providers/default.ts` |
| 7 — Static-fallback warning | `extensions/services/fetch-service.ts` | `extensions/services/static-fetch.ts` |
| 8 — `default` provider name | `extensions/types.ts` | `src/providers/default.ts` |
| 9 — Missing `rawContent` in static fallback | `extensions/services/static-fetch.ts` | — |
| 10 — `spa` vs `html` vs `static` | `extensions/content-types.ts` | `extensions/services/fetch-service.ts` |
| 11 — `webfetch-clear-cache` help | `extensions/commands/webfetch-cache-command.ts` | `README.md` |
