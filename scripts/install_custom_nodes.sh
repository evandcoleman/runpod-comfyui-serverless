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
        # Support url@commit pinning (e.g. https://github.com/user/repo@abc123)
        if [[ "$line" == *@* ]]; then
            url="${line%@*}"
            ref="${line##*@}"
        else
            url="$line"
            ref=""
        fi
        repo_name=$(basename "$url" .git)
        if [ -n "$ref" ]; then
            git clone "$url" "/comfyui/custom_nodes/$repo_name"
            git -C "/comfyui/custom_nodes/$repo_name" checkout "$ref"
        else
            git clone --depth 1 "$url" "/comfyui/custom_nodes/$repo_name"
        fi
        if [ -f "/comfyui/custom_nodes/$repo_name/requirements.txt" ]; then
            pip install -r "/comfyui/custom_nodes/$repo_name/requirements.txt"
        fi
    else
        comfy --workspace /comfyui --skip-prompt node install "$line"
    fi
done < "$CUSTOM_NODES_FILE"

echo "Custom node installation complete"
