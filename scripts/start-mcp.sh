#!/bin/sh
# Claude Code MCP entrypoint for codex-plugin-claude-agent-team.
#
# The repo gitignores node_modules/ and dist/, so on first run after a
# fresh /plugin install we have to install deps and build before we can
# launch the MCP server. Subsequent runs short-circuit when both are
# already present.
#
# Output policy: this script communicates with the MCP host over stdio,
# so we MUST keep stdout clean for the protocol. All progress output
# goes to stderr (the host typically surfaces stderr as plugin logs).
#
# Failure policy: if any setup step fails, exit non-zero with a clear
# stderr message. The MCP host will surface this to the operator.

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if [ ! -d node_modules ]; then
  echo "agent-team MCP: installing npm dependencies (one-time)..." >&2
  npm ci --silent >&2 || {
    echo "agent-team MCP: npm ci failed. Run 'npm ci' manually in $REPO_ROOT to diagnose." >&2
    exit 1
  }
fi

if [ ! -f dist/index.js ]; then
  echo "agent-team MCP: building TypeScript (one-time)..." >&2
  npm run build --silent >&2 || {
    echo "agent-team MCP: build failed. Run 'npm run build' manually in $REPO_ROOT to diagnose." >&2
    exit 1
  }
fi

exec node "$REPO_ROOT/dist/index.js" "$@"
