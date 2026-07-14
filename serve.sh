#!/usr/bin/env zsh

set -eu

SCRIPT_DIR="${0:A:h}"
PORT="${PORT:-4173}"

cd "$SCRIPT_DIR"
echo "Rank-four bijection visualizer: http://127.0.0.1:${PORT}/"
python3 -m http.server "$PORT" --bind 127.0.0.1
