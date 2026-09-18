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

TOOL_PATH="/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin"
if [ -n "${AGENT_TEAM_MCP_PATH_PREFIX:-}" ]; then
  PATH="$AGENT_TEAM_MCP_PATH_PREFIX:$TOOL_PATH:$PATH"
else
  PATH="$TOOL_PATH:$PATH"
fi
export PATH

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "agent-team MCP: node was not found on PATH. Install Node.js 22+ or ensure Codex can see your Node installation." >&2
  exit 1
fi

NODE_VERSION="$(node -v 2>/dev/null || true)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
case "$NODE_MAJOR" in
  ""|*[!0-9]*)
    echo "agent-team MCP: could not determine Node.js version from '$NODE_VERSION'. Install Node.js 22+ or ensure Codex can see a supported Node installation." >&2
    exit 1
    ;;
esac
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "agent-team MCP: Node.js 22+ is required; found $NODE_VERSION at $(command -v node)." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f dist/index.js ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "agent-team MCP: npm was not found on PATH, and first-run setup is required. Install npm or run npm ci && npm run build in $REPO_ROOT." >&2
    exit 1
  fi
fi

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
