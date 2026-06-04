# Changelog

All notable changes to `@rwese/pi-webfetch` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- New `GitHubFetchOptions` object threaded from the CLI / MCP / pi
  extension down to the `gh-cli` provider. The first option is
  `includeComments` (boolean). When `true`, issue conversation
  comments and PR review threads are included in the result.
- CLI: new `--include-comments` flag for `pi-webfetch webfetch`.
  Accepts bare flag, `--include-comments=true`, `--include-comments=false`,
  `yes` / `no`, or `1` / `0`.
- MCP `webfetch` tool: new `includeComments` boolean in the zod input
  schema.
- pi extension `webfetch` tool: new `includeComments` boolean in the
  TypeBox schema (`WEBFETCH_TOOL_PARAMS`).
- Discovery hint: when an issue / PR is fetched without
  `includeComments`, a `> Tip: pass `includeComments: true` ...`
  footer is appended to the markdown content. The same string is
  mirrored as `metadata.githubHint` on the provider's
  `ProviderFetchResult` and as `githubHint` on `WebfetchDetails`,
  so programmatic callers can prompt the user to opt in.

### Changed

- **Default-output change for GitHub issues:** issue conversation
  comments are no longer included by default. Pass
  `--include-comments` (or `includeComments: true` from MCP / the
  pi extension) to restore the previous behaviour. A discovery hint
  is added in its place.
- **Default-output change for GitHub PRs:** PR review thread bodies
  and PR conversation comments are no longer included by default.
  Same opt-in mechanism as for issues.

### Tests

- New `test/gh-cli-options.test.ts` covering `fetchByType` argv
  construction (with and without `--comments`), the discovery
  hint, and `metadata.githubHint` for both issues and PRs.
- New `test/fetch-service-github-hint.test.ts` covering the
  fetch-service plumbing that mirrors `metadata.githubHint` to
  `WebfetchDetails.githubHint` and appends the in-content tail.
- `test/cli.test.ts` and `test/mcp-tools.test.ts` extended for the
  new flag / schema field and forwarding to `webfetchResearch`.
