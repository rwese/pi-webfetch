# TODO: webfetch-research-query

## Phases

- [x] **Phase 1: Create `spawnPiAgent()` helper with fake-pi-process fixture**
  - [x] Create `test/helpers/fake-pi-process.ts` fixture
  - [x] Create `extensions/pi-agent.ts` with `spawnPiAgent()` function
  - [x] Add error handling for spawn failures

- [x] **Phase 2: Implement `webfetchResearch()` function**
  - [x] Add function to `extensions/fetch.ts`
  - [x] Integrate with existing `fetchUrl()` flow
  - [x] Handle missing query (fallback to regular fetch)

- [x] **Phase 3: Register `/webfetch` command with query support**
  - [x] Update command handler in `extensions/index.ts`
  - [x] Parse optional query argument
  - [x] Update tool definition for optional query

- [x] **Phase 4: Add unit tests**
  - [x] Test `spawnPiAgent()` with fake-pi-process
  - [x] Test `webfetchResearch()` with mocked fetch and agent
  - [x] Test error cases (fetch failure, spawn failure)

- [x] **Phase 5: Update AGENTS.md documentation**
  - [x] Add research query feature to AGENTS.md
  - [x] Document usage examples

## Success Criteria

- [x] `/webfetch <url>` still works as before
- [x] `/webfetch <url> <query>` fetches and analyzes content
- [x] Sub-agent receives both content and query
- [x] Errors are caught and displayed user-friendly
- [x] Tests pass with fake-pi-process fixture

---

Last updated: 2026-04-29 ✓ COMPLETE
