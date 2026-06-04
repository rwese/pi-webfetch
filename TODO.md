# Plan Implementation TODO

Plan: PLAN_GH_FETCH_OPTIONS.md (GitHub Fetch Options & Discovery Hints)

## Step 1 — Types & Provider Dispatch (verification first)
- [ ] Add `GitHubFetchOptions` to `src/providers/types.ts` and add `github?: GitHubFetchOptions` to `ProviderConfig` and `FetchConfig`. Add `githubHint?: string` to `FetchMetadata`.
- [ ] Mirror `github?: GitHubFetchOptions` on `ProviderConfig` in `extensions/types.ts` and add `githubHint?: string` to `WebfetchDetails`.
- [ ] Update `src/providers/gh-cli.ts` to pass `config.github` through to `fetchByType`.
- [ ] Update `src/providers/gh/content-fetcher.ts`: extend `fetchByType` and add `GitHubFetchOptions` to `fetchIssue`/`fetchPr` (no behaviour change yet, just option-threading).
- [ ] Add `test/gh-cli-options.test.ts` that exercises `fetchByType` with mocked `execAsync` and asserts the right `gh` argv is built with `includeComments` on/off.
- [ ] Verify: `npm test -- --run test/gh-cli-options.test.ts` passes.

## Step 2 — Core Logic (content + hint)
- [ ] In `fetchIssue`/`fetchPr`, gate `--comments` on `includeComments`; PRs: when on, use `gh pr view --comments` and render review threads + PR conversation comments.
- [ ] Add `buildGitHubHint(parsed)` helper in `src/providers/gh/content-fetcher.ts`; append the hint tail to content and return `metadata.githubHint`.
- [ ] Verify via unit tests in `test/gh-cli-options.test.ts` that hint tail is in `content` and `metadata.githubHint` is set.

## Step 3 — Plumbing (fetch-service / research-service)
- [ ] Extend `fetchUrl` to accept and forward `github?: GitHubFetchOptions` to `manager.fetch` config; also pass it on to `staticFetch` path (not needed for static).
- [ ] In `fetch-service.ts` after a provider fetch, copy `metadata.githubHint` to `details.githubHint` and ensure the hint tail is in the final content.
- [ ] Extend `webfetchResearch` to accept and forward `github?: GitHubFetchOptions`.
- [ ] Verify via tests in `test/webfetch.test.ts`/`test/webfetch-research.test.ts`/`test/gh-cli-options.test.ts` for details.

## Step 4 — Surfaces (CLI / MCP / pi tool)
- [ ] `extensions/cli.ts` — add `--include-comments` flag; parse boolean; forward to `webfetchResearch`.
- [ ] `extensions/mcp-tools.ts` — add `includeComments: z.boolean().optional()` to zod schema; forward to `webfetchResearch`.
- [ ] `extensions/tools/webfetch.ts` — add `includeComments: Type.Optional(Type.Boolean())` to TypeBox schema; forward to `webfetchResearch`.
- [ ] Update `extensions/commands/webfetch-command.ts` to pass through option (if user has any way to pass via slash command — out of scope unless trivially possible; only check).
- [ ] Verify: `npm test -- --run test/cli.test.ts test/mcp-tools.test.ts` passes with new assertions.

## Step 5 — Polish
- [ ] Run `npm run report-url` and `npm run test:regression` (or refresh snapshots for `github-com-nodejs-node-issue-1.md` and `github-com-facebook-react-pr-1.md`); mark cases as `passing` if appropriate.
- [ ] Update `README.md` (one paragraph) describing `--include-comments` and the new default for issues.
- [ ] Update `BACKLOG.md` — add "GitHub fetch gaps" section enumerating: git protocol URLs, recursive listings, PR diffs, link following, size guard, detector alignment, gh-cli-as-requirement.
- [ ] `CHANGELOG.md` (create if absent) — mention default-output change for issues.
- [ ] Run `npm run validate` (lint + typecheck + tests); fix issues.
- [ ] No `TODO`/`FIXME`/debug code left behind.

## Definition of Done
- [ ] All step items complete.
- [ ] `npm run validate` green.
- [ ] Clean commits per step.
