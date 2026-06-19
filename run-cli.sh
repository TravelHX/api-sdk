#!/usr/bin/env bash
#
# run-cli.sh - launch the API SDK interactive CLI inside Docker.
#
# Builds (if needed) and runs the SDK CLI in an interactive container, letting
# you pick the .NET or the JS implementation. Both CLIs get ./data and
# ./config.json mounted read-only and a TTY (docker compose run allocates one
# by default), which the full-screen TUIs require.
#
# Usage:
#   ./run-cli.sh            # interactive prompt (1 = .NET, 2 = JS)
#   ./run-cli.sh dotnet     # run the .NET CLI
#   ./run-cli.sh js         # run the JS CLI
#
set -euo pipefail

# Run from the script's own directory so relative compose paths and the
# config.json/data mounts resolve regardless of where this is invoked from.
cd "$(dirname "$0")"

# --- Preconditions ----------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: 'docker' is not installed or not on PATH." >&2
  echo "Install Docker Desktop / Docker Engine and try again." >&2
  exit 1
fi

usage() {
  echo "Usage: $0 [dotnet|js]" >&2
}

# --- Resolve the choice (CLI arg, else interactive prompt) ------------------
choice="${1:-}"

if [ -z "$choice" ]; then
  # No argument: ask interactively. This is a launcher, so a prompt is fine.
  echo "Which SDK CLI do you want to run?"
  echo "  1) .NET"
  echo "  2) JS"
  printf "Enter 1 or 2: "
  read -r answer
  case "$answer" in
    1) choice="dotnet" ;;
    2) choice="js" ;;
    *) echo "Error: invalid selection '$answer'." >&2; usage; exit 1 ;;
  esac
fi

# Map the choice to its docker compose service.
case "$choice" in
  dotnet) service="dotnet-cli" ;;
  js)     service="node-cli" ;;
  *)      echo "Error: unknown option '$choice'." >&2; usage; exit 1 ;;
esac

# --- Launch -----------------------------------------------------------------
# `docker compose run --rm --build <service>`:
#   --build  : (re)build the image so code changes are picked up
#   --rm     : remove the one-off container when the CLI exits
#   (a TTY is allocated by default, which the TUI needs)
echo "Launching the ${choice} SDK CLI (compose service: ${service})..."
exec docker compose run --rm --build "$service"
