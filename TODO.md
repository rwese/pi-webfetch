# Plan Implementation TODO

Plan: PLAN_GH_FETCH_OPTIONS.md (GitHub Fetch Options & Discovery Hints)

## Step 1 — Types & Provider Dispatch (verification first) — DONE
- [x] Add `GitHubFetchOptions` to `src/providers/types.ts` and add `github?: GitHubFetchOptions` to `ProviderConfig` and `FetchConfig`. Add `githubHint?: string` to `FetchMetadata`.
- [x] Mirror `github?: GitHubFetchOptions` on `ProviderConfig` in `extensions/types.ts` and add `githubHint?: string` to `WebfetchDetails`.
- [x] Update `src/providers/gh-cli.ts` to pass `config.github` through to `fetchByType`.
- [x] Update `src/providers/gh/content-fetcher.ts`: extend `fetchByType` and add `GitHubFetchOptions` to `fetchIssue`/`fetchPr` (no behaviour change yet, just option-threading).
- [x] Add `test/gh-cli-options.test.ts` that exercises `fetchByType` with mocked `execAsync` and asserts the right `gh` argv is built with `includeComments` on/off.
- [x] Verify: `npm test -- --run test/gh-cli-options.test.ts` passes. 19/19.

## Step 2 — Core Logic (content + hint) — DONE
- [x] In `fetchIssue`/`fetchPr`, gate `--comments` on `includeComments`; PRs: when on, use `gh pr view --comments` and render review threads + PR conversation comments.
- [x] Add `buildGitHubHint(parsed)` helper in `src/providers/gh/content-fetcher.ts`; append the hint tail to content and return `metadata.githubHint`.
- [x] Verify via unit tests in `test/gh-cli-options.test.ts` that hint tail is in `content` and `metadata.githubHint` is set.

## Step 3 — Plumbing (fetch-service / research-service) — DONE
- [x] Extend `fetchUrl` to accept and forward `github?: GitHubFetchOptions` to `manager.fetch` config; also pass it on to `staticFetch` path (not needed for static).
- [x] In `fetch-service.ts` after a provider fetch, copy `metadata.githubHint` to `details.githubHint` and ensure the hint tail is in the final content.
- [x] Extend `webfetchResearch` to accept and forward `github?: GitHubFetchOptions`.
- [x] Verify via tests in `test/fetch-service-github-hint.test.ts` for details.

## Step 4 — Surfaces (CLI / MCP / pi tool) — DONE
- [x] `extensions/cli.ts` — add `--include-comments` flag; parse boolean; forward to `webfetchResearch`.
- [x] `extensions/mcp-tools.ts` — add `includeComments: z.boolean().optional()` to zod schema; forward to `webfetchResearch`.
- [x] `extensions/tools/webfetch.ts` — add `includeComments: Type.Optional(Type.Boolean())` to TypeBox schema; forward to `webfetchResearch`.
- [x] Verify: `npm test -- --run test/cli.test.ts test/mcp-tools.test.ts` passes with new assertions.

## Step 5 — Polish — DONE
- [x] Run `npm run test:regression` — passes (41 tests). Confirmed that the GitHub issue/PR cases use `provider: default` (HTML scraping), not gh-cli, so the default-output change does not affect them.
- [x] Update `README.md` (paragraphs) describing `--include-comments` and the new default for issues.
- [x] Update `BACKLOG.md` — add "GitHub fetch gaps" section enumerating: git protocol URLs, recursive listings, PR diffs, link following, size guard, detector alignment, gh-cli-as-requirement, additional GitHub options.
- [x] `CHANGELOG.md` — mention default-output change for issues.
- [x] Run `npm run validate` (lint + typecheck + tests) — green.
- [x] No `TODO`/`FIXME`/debug code left behind.

## Definition of Done
- [x] All step items complete.
- [x] `npm run validate` green.
- [x] Clean commits per step.
