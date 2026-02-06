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
    if [[ "$line" == http* ]]; then
        repo_name=$(basename "$line" .git)
        git clone --depth 1 "$line" "/comfyui/custom_nodes/$repo_name"
        if [ -f "/comfyui/custom_nodes/$repo_name/requirements.txt" ]; then
            pip install -r "/comfyui/custom_nodes/$repo_name/requirements.txt"
        fi
    else
        comfy --workspace /comfyui --skip-prompt node install "$line"
    fi
done < "$CUSTOM_NODES_FILE"

echo "Custom node installation complete"
