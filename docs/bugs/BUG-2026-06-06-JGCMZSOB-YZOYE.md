---
state: fixed
needed: true
severity: low
type: bug
component: src/providers/internal/turndown-config.ts
reported: 2026-06-06
tested_against: v0.9.0
fixed_in: pending (MathJax denylist in `PAGE_DENYLIST_EXTRA` + `addMathJaxRule` in `turndown-config.ts` + `test/fixtures/wikipedia-pi-math.html` + `test/wikipedia-math-cleanup.test.ts`)
test_matrix: docs/reviews/webfetch-review-2026-06-06.md (call 12)
notes: 'Wikipedia inline MathJax `<span>` elements are converted by turndown to literal TeX source (e.g. `{\displaystyle \pi ={\frac {C}{d}}}`) alongside the rendered SVG / MathML. The output is noisy and breaks the "fidelity to the rendered page" goal of the markdown post-processor.'
---

# BUG-2026-06-06-JGCMZSOB-YZOYE — Wikipedia inline MathJax TeX source leaks into markdown output

## Summary

When the default provider renders a Wikipedia article (e.g. `https://en.wikipedia.org/wiki/Pi`), the cheerio+turndown pipeline converts Wikipedia's inline MathJax `<span>` elements to their literal TeX source as well as the rendered SVG / MathML fallback. The output markdown contains both:

- the rendered image / MathML: `![{\displaystyle \pi ={\frac {C}{d}}.}](https://wikimedia.org/api/rest_v1/media/math/render/svg/f98a23e73a342246e95838018afd6f157a859564)`
- the literal TeX source: `{\displaystyle \pi ={\frac {C}{d}}.}`

The TeX source is also repeated inline in the text where Wikipedia's accessibility markup placed it. The end result is unreadable: a single formula can appear 3-4 times in the output (definition TeX, rendered image alt-text, inline TeX, screen-reader fallback).

This is a fidelity regression introduced in v0.9.0 alongside the table-fidelity fix (Finding #4). It is **not** a regression of Finding #5 (`\[` / `\]` escapes), which was correctly fixed in the article body; the noise is the `<span class="mwe-math-mathml-inline">` content that Wikipedia uses for screen readers.

## Reproduction

```bash
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js clear-cache --all
node /Users/wese/Repos/github.com/rwese/pi-webfetch/dist/extensions/cli.js webfetch https://en.wikipedia.org/wiki/Pi > /tmp/wf-pi.txt
rg -c '\\\\displaystyle|\\\\frac' /tmp/wf-pi.txt
```

**Expected**: zero matches in the body. The markdown should contain either the rendered image link (preferred) or a code-fenced LaTeX block, but not the raw TeX duplicated 3-4 times.

**Actual** (truncated):

```
The circumference of a circle is slightly more than three times as long as its diameter. The exact ratio is called π.

π is commonly defined as the [ratio](/wiki/Ratio "Ratio") of a [circle](/wiki/Circle "Circle")'s [circumference](/wiki/Circumference "Circumference") C to its [diameter](/wiki/Diameter "Diameter"): π \= C d . {\displaystyle \pi ={\frac {C}{d}}.} ![{\displaystyle \pi ={\frac {C}{d}}.}](https://wikimedia.org/api/rest_v1/media/math/render/svg/f98a23e73a342246e95838018afd6f157a859564) In [Euclidean geometry](/wiki/Euclidean_geometry "Euclidean geometry"), the ratio C d {\textstyle {\frac {C}{d}}} ![{\textstyle {\frac {C}{d}}}](https://wikimedia.org/api/rest_v1/media/math/render/svg/c8ebfc4cd5de67be49da2841f490d1d55053a1c4) is constant, regardless of the circle's size.
```

The literal `{\displaystyle …}` and `{\textstyle …}` strings appear throughout the article. The `C` and `d` letters in the surrounding prose are also a MathJax layout artefact: Wikipedia wraps the variable in a `<span>` so the layout engine can position it, and turndown extracts the text content of that span without the surrounding formula context.

## Root cause analysis

### Where the TeX comes from

Wikipedia's inline MathJax markup has the shape:

```html
<span class="mwe-math-mathml-inline mwe-math-mathml-display"
      style="display: inline-block;">
  <math xmlns="http://www.w3.org/1998/Math/MathML" alttext="\pi ={\frac {C}{d}}">
    <semantics>
      <mrow>…MathML…</mrow>
      <annotation encoding="TeX">\pi ={\frac {C}{d}}</annotation>
    </semantics>
  </math>
  <img alt="{\displaystyle \pi ={\frac {C}{d}}}"
       src="…/math/render/svg/…"
       aria-hidden="true" />
  <span style="display: none;">{\displaystyle \pi ={\frac {C}{d}}}</span>
</span>
```

Three sources of TeX in the same span:

1. The MathML `<annotation encoding="TeX">` — the canonical TeX source.
2. The `<img alt="…">` — the screen-reader alt text, which is the same TeX rendered.
3. The hidden `<span style="display: none">` — the display-none fallback for browsers without MathML support.

`turndown`'s default `textContent` extraction picks up all three.

### Why v0.9.0 made it worse

The M2 milestone in `docs/plans/PLAN_WEBFETCH_REVIEW_FIXES.md` added cheerio-based HTML cleaning with an `extraDenylistSelectors` stack (Finding #3 — Wikipedia donation banner — and Finding #4 — table cleanup). The cleaning pass strips banner and noise but does not touch MathJax spans. Turndown then runs on the cleaned HTML and extracts the text content of every `<span>`, including the MathJax spans.

The result: every TeX expression appears 3-4 times, and the inline layout characters (`\=`, `\;`, `\,`, `\;`) confuse the markdown link-parser downstream, occasionally swallowing the next link as a TeX argument.

### Why Finding #5 did not catch this

Finding #5 was about the markdown post-processor leaking escaped brackets (`\[` and `\]`) when the source HTML had explicit code-block escape sequences. The new bug is upstream of the post-processor: the TeX is already in the turndown output. The post-processor's `markdown-unescape.ts` and `markdown-escaping.ts` are not the issue.

## Impact

- **Readability.** A user reading the markdown cannot tell which `{\displaystyle …}` is the actual content and which is layout noise.
- **Token cost.** The Wikipedia Pi article weighs 891 KB raw; the rendered markdown is 100 KB (truncated). The TeX duplication is roughly 5-8 % of the rendered output — about 5-8 KB of duplicate MathML / TeX in a single article.
- **Downstream agents.** A research subagent that reads the markdown may be confused by the multiple TeX representations of the same formula. The "list the first 50 decimal digits" question we asked in call 13 succeeded, but a "summarise the formula for the Gaussian integral" question would have been much harder to answer cleanly with the current output.
- **Not a blocker.** The TeX is readable; it is just noisy. This is severity LOW.

## TODO

- [x] Add a MathJax denylist selector to `PAGE_DENYLIST_EXTRA` in `src/providers/default.ts`. The selectors to denylist:
  - `span.mwe-math-mathml-display` and `span.mwe-math-mathml-inline` (Wikipedia's wrapper)
  - `math annotation[encoding="TeX"]` (the canonical TeX source) — see note: the `cheerio` `cleanHtml` strips the whole wrapper, so the MathML `<annotation>` is gone with the wrapper; the `addMathJaxRule` is the belt-and-braces for the static `cleanHtml` callers.
  - `span[style*="display: none"]` inside a `mwe-math-*` parent (the display-none fallback) — scoped to a `mwe-math-*` parent, not a global `display: none` strip.
- [x] Keep the rendered `<img>` element. It is the visible formula and is the most useful representation for a downstream LLM. The `addMathJaxRule` turndown rule produces a single `![alt](src)` markdown image link.
- [x] Update the `turndown-config.ts` to add a custom rule for the `<span class="mwe-math-*">` element that strips everything but the rendered image, dropping the alt text, the MathML, and the display-none fallback.
- [x] Add a fixture `test/fixtures/wikipedia-pi-math.html` (a small slice of `https://en.wikipedia.org/wiki/Pi` containing 1-2 formula spans) and assert the output contains the rendered `<img>` and **not** the literal TeX strings.
- [x] Add a `wikipedia-math-cleanup.test.ts` regression test that runs the default provider against the fixture and asserts the body has zero `\\displaystyle` / `\\textstyle` / `\\frac` matches.

## Scope

### In scope

- `src/providers/default.ts` — extend `PAGE_DENYLIST_EXTRA` with the MathJax selectors.
- `src/providers/internal/turndown-config.ts` — add the MathJax turndown rule.
- `test/fixtures/wikipedia-pi-math.html` — new fixture.
- `test/wikipedia-math-cleanup.test.ts` — new regression test.

### Out of scope

- Rendering TeX to Unicode / KaTeX server-side. That is a much larger feature and depends on user need.
- Cleaning up the `<img alt="…TeX…">` alt text. The alt text is intentionally the same as the visual content for accessibility; keeping it lets the LLM see the formula when there is no rendered image. If the rendered image is always present, the alt text is duplicate noise and can be stripped in the turndown rule.
- Cleaning up non-Wikipedia TeX (Stack Exchange, MathOverflow, etc.). The selector denylist is specific to MediaWiki's `mwe-math-*` class names. Other sites' MathJax markup can be addressed in a follow-up if it becomes a complaint.

## Acceptance Criteria

- [ ] The 2026-06-06 test matrix call 12 (`https://en.wikipedia.org/wiki/Pi`) output contains zero `{\displaystyle …}` or `{\textstyle …}` strings in the body. _(gated on live test matrix re-run; the unit / integration tests pass on the offline fixture.)_
- [x] The rendered image links `![…](https://wikimedia.org/api/rest_v1/media/math/render/svg/…)` are still present (the `addMathJaxRule` produces a single `![alt](src)` markdown image link).
- [x] A new fixture test (`wikipedia-math-cleanup.test.ts`) passes.
- [x] `npm run validate` exits 0 with the new tests.
- [x] No regression on the table-fidelity fix (Finding #4) — the existing `test/table-wikitables.test.ts` suite still passes (5 tests).

## Validation

```bash
cd /Users/wese/Repos/github.com/rwese/pi-webfetch
npm install
npm run validate
npm run build
node dist/extensions/cli.js clear-cache --all

# Targeted: call 12 must now have zero TeX strings
node dist/extensions/cli.js webfetch https://en.wikipedia.org/wiki/Pi > /tmp/wf-pi.txt
rg -c '\\displaystyle|\\textstyle|\\frac' /tmp/wf-pi.txt
# Acceptance: 0 matches

# Regression: call 2 must still have a clean table
node dist/extensions/cli.js webfetch https://en.wikipedia.org/wiki/Web_browser > /tmp/wf-wb.txt
rg -A 20 'Web browser$' /tmp/wf-wb.txt | head -25
# Acceptance: a 3-column markdown table with browser name, market share, reference

# Full matrix re-run
# See .agents/references/webfetch-testing.md
```

## Risks / Rollback

- **Risk:** the MathJax denylist is specific to MediaWiki's class names. Other wikis (Fandom, Miraheze, custom MediaWiki installs) may use different classes. *Mitigation:* the selector is `*=mwe-math-*` which catches the MediaWiki-extensions' class prefix. Other sites can extend `extraDenylistSelectors` via `ProviderConfig`.
- **Risk:** removing the TeX makes the markdown less searchable for an LLM that uses TeX to recognise mathematical content. *Mitigation:* the rendered `<img>` alt text is preserved; the SVG URL contains the formula's hash. An LLM that needs the TeX can re-fetch the image and read the alt text.
- **Risk:** the `span[style*="display: none"]` denylist may catch legitimate hidden content on other sites. *Mitigation:* scope the denylist to a parent `mwe-math-*` wrapper, not a global `display: none` strip.
- **Rollback:** the denylist extension and the turndown rule are additive. A revert removes both. No public API change.
