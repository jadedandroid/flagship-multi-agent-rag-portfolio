#!/usr/bin/env bash
set -euo pipefail

node_binary="${PAYMENT_MCP_NODE:-$(command -v node || true)}"

node_major() {
  [[ -n "$node_binary" ]] && "$node_binary" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0\n'
}

major="$(node_major)"
if (( major < 20 )); then
  nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    source "$nvm_dir/nvm.sh"
    if ! nvm use --silent 24 >/dev/null 2>&1 && ! nvm use --silent 20 >/dev/null 2>&1; then
      printf 'Payment MCP requires Node.js 20 or later. Install Node 20+ or set PAYMENT_MCP_NODE.\n' >&2
      exit 1
    fi
    node_binary="$(command -v node)"
  elif [[ -n "${PAYMENT_MCP_NODE:-}" ]]; then
    node_binary="$PAYMENT_MCP_NODE"
  else
    printf 'Payment MCP requires Node.js 20 or later. Install Node 20+ or set NVM_DIR.\n' >&2
    exit 1
  fi
fi

major="$(node_major)"
if (( major < 20 )); then
  printf 'Payment MCP requires Node.js 20 or later; detected Node %s.\n' "$major" >&2
  exit 1
fi

exec "$node_binary" "$(dirname "$0")/src/server.mjs"
