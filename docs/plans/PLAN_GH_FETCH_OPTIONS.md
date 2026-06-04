# GitHub Fetch Options & Discovery Hints

## Context

<goal>Add GitHub-specific fetch options (currently centered on comments/review threads) to the gh-cli provider, plumb them through the CLI / MCP / pi-extension surfaces, and emit a discovery hint when an issue/PR is fetched without those options. Existing URL routing and behavior for non-GitHub URLs must stay identical. Backlog items unrelated to this slice are deferred.</goal>

## Scope

**In Scope:**

- New `GitHubFetchOptions` type, threaded from CLI/MCP/pi-tool down to `GhCliProvider`.
- A first flag: `includeComments` (default **off** for both issues and PRs).
  - Issues: when off → no `--comments` to `gh issue view`; when on → `--comments` (current behavior).
  - PRs: when off → no review threads, no PR conversation comments (current behavior); when on → call `gh pr view --comments` and render review bodies + PR conversation comments.
- Footer hint on the gh-cli provider's result for `issue`/`pr` URLs when `includeComments` is not set:
  - Inline in the markdown content (`> Tip: ...`).
  - Mirror as a `metadata.githubHint` string on the `ProviderFetchResult` and a `githubHint` field on `WebfetchDetails` for programmatic access.
- CLI flag `--include-comments` on the `webfetch` subcommand.
- MCP tool: add `includeComments: z.boolean().optional()` to the `webfetch` input schema.
- pi extension tool: add `includeComments: Type.Optional(Type.Boolean())` to the `WEBFETCH_TOOL_PARAMS` TypeBox schema and forward to `webfetchResearch`.
- No change to URL routing, fallback chain, or non-GitHub behavior.

**Out of Scope (deferred to BACKLOG):**

- Git-protocol URLs (`git+https://`, `ssh://git@github.com/...`, `.git` URLs, GHE hosts).
- Recursive directory listings / cross-file link following.
- PR diffs, checks, "open issues in repo" expansion.
- Size guard on `fetchFile` raw content.
- Manager-level detector disagreement on `raw.githubusercontent.com` for gh-cli.
- Auto-fetching of referenced issues/PRs from inside a fetched body.

## Acceptance Criteria

- [ ] Calling `webfetch <github-issue-url>` (no flags) returns a result whose content **does not** contain a `## Comments` section, and **does** contain a discovery hint footer.
- [ ] Calling `webfetch <github-pr-url>` (no flags) returns a result whose content does **not** contain a review thread body section or `## Comments`, and **does** contain the discovery hint footer.
- [ ] Calling `webfetch <github-issue-url> --include-comments` returns the **current** issue output (with `## Comments`), and the hint footer is **absent**.
- [ ] Calling `webfetch <github-pr-url> --include-comments` returns PR output including review threads and PR conversation comments, and the hint footer is **absent**.
- [ ] Non-GitHub URLs (e.g. `https://example.com`) show no hint, no change in content.
- [ ] The result's `details.githubHint` (and `result.metadata.githubHint` on the provider's `ProviderFetchResult`) carries the same hint string as the in-content footer.
- [ ] The MCP `webfetch` tool and the pi extension `webfetch` tool both accept `includeComments` and forward it correctly.
- [ ] `npm run validate` (lint + typecheck + tests) passes.
- [ ] `test/cli.test.ts`, `test/mcp-tools.test.ts`, and a new `test/gh-cli-options.test.ts` are updated/added.
- [ ] Backlog gaps from the prior review are recorded in `BACKLOG.md` under a new "GitHub fetch gaps" section.

## First Verifiable State

**Order first, not time.** First, add the option types and a unit test for the gh-cli provider's `fetchByType` dispatching with `includeComments`. That test is the smallest proof that the option reaches the provider.

- [ ] First task: define `GitHubFetchOptions` in `src/providers/types.ts` and `extensions/types.ts`, thread it through `ProviderConfig` / `FetchConfig`, and add a vitest in `test/gh-cli-options.test.ts` that exercises `fetchByType(gh, parsed, timeout, { includeComments: true })` against a mock that asserts the right `gh` argv is built.
- [ ] How to verify: `npm test -- --run test/gh-cli-options.test.ts` passes; the mock assertion confirms the right `gh` flags were passed.

## Implementation Notes

- **Tech decisions:**
  - Use a single `GitHubFetchOptions` object so future options (e.g. `maxCommentDepth`, `includeReviews`, `includeReactions`) are additive without further signature churn.
  - The provider accepts the option via `config.github` (not a new positional argument), keeping the `WebfetchProvider.fetch` signature stable.
  - Footer construction is centralized in a helper in `src/providers/gh/content-fetcher.ts` so the message can be tuned in one place. The same helper produces both the markdown tail and the `githubHint` string.
  - The hint message is generic: it tells the caller the option name and how to pass it. We do **not** hard-code CLI syntax into the hint, because the same code path serves MCP and pi extension too. Use a phrasing like:

    > Tip: pass `includeComments: true` (CLI: `--include-comments`) to include issue comments and PR review threads.

  - Backward compatibility: this is a **default-output change** for issues (comments no longer included by default). This is a deliberate choice confirmed with the user. Mention it in `CHANGELOG.md`/README.

- **Key files to touch:**
  - `src/providers/types.ts` — add `GitHubFetchOptions` and `github?: GitHubFetchOptions` on `ProviderConfig`/`FetchConfig`; add `githubHint?: string` on `FetchMetadata`.
  - `extensions/types.ts` — mirror `github?: GitHubFetchOptions` on `ProviderConfig`; add `githubHint?: string` on `WebfetchDetails`.
  - `src/providers/gh/content-fetcher.ts` — change `fetchIssue` and `fetchPr` to accept `GitHubFetchOptions`; conditionally pass `--comments`; append hint to content; return `metadata.githubHint`.
  - `src/providers/gh-cli.ts` — pass `config.github` to `fetchByType`.
  - `extensions/services/fetch-service.ts` — `fetchUrl` accepts an options object (or just a `github` field) and forwards it into `manager.fetch`'s config.
  - `extensions/services/research-service.ts` — `webfetchResearch` accepts the option and forwards to `fetchUrl`. After getting the provider result, copy `metadata.githubHint` to `details.githubHint` in the `processProviderResult` flow. Note: gh-cli results currently bypass `processProviderResult` because `shouldUseProvider` is true only for non-raw GitHub URLs. The hint must still land in the output for gh-cli — easiest: add a single line in `fetchUrl` that, if the provider result has a `metadata.githubHint`, copies it to `details.githubHint` and appends the same hint tail to the content.
  - `extensions/cli.ts` — add `--include-comments` flag, forward to `webfetchResearch`.
  - `extensions/mcp-tools.ts` — add `includeComments: z.boolean().optional()` to the zod schema; forward to `webfetchResearch`.
  - `extensions/tools/webfetch.ts` — add `includeComments: Type.Optional(Type.Boolean())` to the TypeBox schema; forward to `webfetchResearch`.
  - `BACKLOG.md` — add a new section enumerating the GitHub gaps from the prior review (git protocol, recursive listings, PR diffs, link following, size guard, detector alignment, gh-cli-as-requirement).
  - `README.md` — short note on the new flag and the new default for issues (one paragraph).
  - Tests:
    - `test/gh-cli-options.test.ts` (new) — table-driven tests of `fetchByType` argv construction with `includeComments` on/off for issue + pr; verify hint presence/absence in returned `content` and `metadata.githubHint`.
    - `test/cli.test.ts` — extend to cover `--include-comments` flag parsing and forwarding to `webfetchResearch`.
    - `test/mcp-tools.test.ts` — extend to cover the new schema field.
  - `test/cases/github-com-facebook-react-pr-1.md` and `test/cases/github-com-nodejs-node-issue-1.md` — confirm or refresh regression snapshots if the default issue output changes (comments no longer included by default).

- **Tests needed:**
  - `gh-cli-options.test.ts`: argv assembly; hint presence; metadata.
  - `cli.test.ts`: flag parsing + forwarding.
  - `mcp-tools.test.ts`: schema accepts and forwards `includeComments`.
  - Existing regression suite: rerun and update snapshots if issue/PR default output changes.

## Incremental Plan

1. **[Verification First — types & dispatch]** — Add `GitHubFetchOptions`, extend `ProviderConfig`/`FetchConfig` in both type files, add the empty-pass-through in `GhCliProvider.fetch`, and write `test/gh-cli-options.test.ts` with mocked `execAsync` so we can assert the argv passed to `gh`. **Verify:** `npm test -- --run test/gh-cli-options.test.ts` passes with the new tests asserting correct argv for both `issue` and `pr`, with `includeComments` on and off.

2. **[Core Logic — issue/PR content]** — In `fetchIssue`/`fetchPr`, gate `--comments` on `includeComments`; for PRs, when on, switch to `gh pr view --comments` and render review threads + PR conversation comments. Use a single `buildGitHubHint(parsed)` helper for the footer text. **Verify:** unit tests in `gh-cli-options.test.ts` cover the hint tail in `content` and the `metadata.githubHint` string.

3. **[Core Logic — plumbing]** — Extend `fetchUrl` (`fetch-service.ts`) to accept `github?: GitHubFetchOptions`; extend `webfetchResearch` to accept and forward it; after a successful provider fetch, copy `metadata.githubHint` into `details.githubHint` and append the hint tail to the final content if the provider didn't already do so. **Verify:** add a `webfetch` test that asserts the details field is populated when the underlying provider returns a hint.

4. **[Surfaces — CLI / MCP / pi tool]** — Add the flag/zod/TypeBox fields and forward to `webfetchResearch`. **Verify:** `npm test -- --run test/cli.test.ts test/mcp-tools.test.ts` passes with new assertions; manual `npx -y @rwese/pi-webfetch webfetch <gh-issue> --include-comments` confirms behavior end-to-end.

5. **[Polish — regression, docs, backlog]** — Rerun `npm run report-url` and `npm run test:regression` to refresh or update snapshots for the changed default issue output. Update `README.md` (one paragraph) and `CHANGELOG.md` if present. Add a new section to `BACKLOG.md` enumerating the GitHub gaps from the prior review (git protocol URLs, recursive listings, PR diffs, link following, size guard, detector alignment, gh-cli-as-requirement). **Verify:** `npm run validate` (lint + typecheck + full test suite) green.

## Definition of Done

- [ ] First verification (step 1) passes.
- [ ] Core logic (steps 2-3) complete and unit-tested.
- [ ] All three surfaces (step 4) forward the option correctly and are test-covered.
- [ ] `npm run validate` green.
- [ ] Regression snapshots refreshed/updated.
- [ ] `README.md`, `BACKLOG.md`, and `CHANGELOG.md` (if present) updated.
- [ ] No `TODO`/`FIXME`/debug code left behind.
- [ ] `gh-cli.ts` only invoked via `npm run mcp` / `npx -y @rwese/pi-webfetch mcp` / `node dist/extensions/cli.js mcp`; no regression of the existing spawn rule.
