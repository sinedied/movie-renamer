#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(dirname "$0")"

movie-renamer "$SCRIPT_DIR"
read -p "Press any key to continue..."
