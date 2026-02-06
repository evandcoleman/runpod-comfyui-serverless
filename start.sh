#!/usr/bin/env bash
set -euo pipefail

# Use tcmalloc for better memory performance
export LD_PRELOAD=libtcmalloc_minimal.so.4

# Copy extra model paths config if network volume exists
if [ -d "/runpod-volume/models" ]; then
    echo "Network volume detected, enabling extra model paths"
    cp /app/config/extra_model_paths.yaml /comfyui/extra_model_paths.yaml
fi

# Download models if not already present
echo "Checking models..."
python /app/scripts/download_models.py

echo "Starting ComfyUI server..."
cd /comfyui
python main.py \
    --disable-auto-launch \
    --disable-metadata \
    --listen \
    --port 8188 &

echo "Starting RunPod handler..."
cd /app
python -u handler.py
