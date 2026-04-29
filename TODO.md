## Goal

Improve webfetch extension output for better user experience: progress indicators, cleaner rendering, and more polished UI.

## Done

- [x] **Progress indicators** - Globe animation + status during fetch
- [x] **Quote parsing fix** - Queries with quotes display correctly
- [x] **Full-width separators** - Matches pi's notification style
- [x] **Simple rendering** - Plain text, no fancy boxes
- [x] **Updated deps** - `pi-coding-agent@0.70.6`

## Output Format

Both simple fetch and research results now use full-width dash separators:

```
────────────────────────────────────────────────────────────────────────────────
🌐 Fetch Result: https://example.com
Provider: default
...content...
────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────
🔍 Research Result
/webfetch url "query"
...analysis...
────────────────────────────────────────────────────────────────────────────────
```

## Changes

- `extensions/index.ts` - Working indicator, quote stripping
- `extensions/message-renderers.ts` - FullWidthSeparator component, simple text rendering

## Testing

```bash
tmux new-session -d -s webfetch-test -n pi
tmux send-keys -t webfetch-test:pi 'pi -ne -e . 2>&1' Enter
tmux send-keys -t webfetch-test:pi '/webfetch https://example.com' Enter
tmux send-keys -t webfetch-test:pi '/webfetch https://nope.at "list 3 things"' Enter
tmux capture-pane -t webfetch-test:pi -p -S -30
tmux kill-session -t webfetch-test
```
