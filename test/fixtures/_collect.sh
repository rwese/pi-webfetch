#!/usr/bin/env bash
#
# _collect.sh - Collect HTTP response fixtures for regression testing
#
# Usage:
#   ./test/fixtures/_collect.sh <url> <name> [provider]
#
# Output:
#   <name>/
#   ├── response.json   - Status, headers, body file ref
#   └── body.raw        - Raw response body
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$(cd "$(dirname "$SCRIPT_DIR")" && pwd)/fixtures"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <url> <name> [provider]"
    exit 1
}

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

URL="${1:-}"
NAME="${2:-}"
PROVIDER="${3:-default}"

[[ -z "$URL" || -z "$NAME" ]] && usage

NAME=$(basename "$NAME" | sed 's/[^a-zA-Z0-9_-]/_/g')

FIXTURE_DIR="$FIXTURES_DIR/$NAME"

mkdir -p "$FIXTURES_DIR"

if [[ -d "$FIXTURE_DIR" ]]; then
    log_warn "Fixture already exists: $FIXTURE_DIR"
    read -p "Overwrite? [y/N] " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
    rm -rf "$FIXTURE_DIR"
fi

mkdir -p "$FIXTURE_DIR"

log_info "Fetching: $URL"

FETCHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HEADER_TMP=$(mktemp)
BODY_TMP=$(mktemp)

trap 'rm -f "$HEADER_TMP" "$BODY_TMP"' EXIT

HTTP_STATUS=$(curl -sLo "$BODY_TMP" -D "$HEADER_TMP" -w "%{http_code}" "$URL") || {
    log_error "curl failed"
    exit 1
}

CONTENT_TYPE=$(grep -i "^content-type:" "$HEADER_TMP" | head -1 | sed 's/^[^:]*: *//' | tr -d '\r\n' || echo "unknown")

if [[ "$CONTENT_TYPE" == *"text/html"* ]]; then
    SAVE_AS="html"
elif [[ "$CONTENT_TYPE" == *"application/json"* ]]; then
    SAVE_AS="json"
elif [[ "$CONTENT_TYPE" == *"text/"* ]]; then
    SAVE_AS="text"
else
    SAVE_AS="binary"
fi

# Build JSON
python3 "$SCRIPT_DIR/_collect.py" \
    --url "$URL" \
    --name "$NAME" \
    --provider "$PROVIDER" \
    --fetched-at "$FETCHED_AT" \
    --status "$HTTP_STATUS" \
    --content-type "$CONTENT_TYPE" \
    --encoding "$SAVE_AS" \
    --header-file "$HEADER_TMP" \
    --body-file "$BODY_TMP" \
    --output-dir "$FIXTURES_DIR"

log_info "✅ Fixture collected: $NAME"
log_info "   Dir: $FIXTURE_DIR"
log_info "   HTTP Status: $HTTP_STATUS"
