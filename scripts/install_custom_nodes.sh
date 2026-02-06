#!/usr/bin/env bash
set -euo pipefail

CUSTOM_NODES_FILE="${1:-config/custom_nodes.txt}"

if [ ! -f "$CUSTOM_NODES_FILE" ]; then
    echo "No custom nodes file found at $CUSTOM_NODES_FILE, skipping"
    exit 0
fi

while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines and comments
    line=$(echo "$line" | xargs)
    [[ -z "$line" || "$line" == \#* ]] && continue

    echo "Installing custom node: $line"
    comfy node install "$line"
done < "$CUSTOM_NODES_FILE"

echo "Custom node installation complete"
