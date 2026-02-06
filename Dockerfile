# Stage 1: Base image with ComfyUI and dependencies
FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_PREFER_BINARY=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.12 \
    python3.12-venv \
    python3-pip \
    git \
    wget \
    curl \
    libgl1 \
    libglib2.0-0 \
    libgoogle-perftools4t64 \
    && rm -rf /var/lib/apt/lists/*

# Make python3.12 the default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.12 1 && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1

# Install uv for fast package management
RUN pip install --break-system-packages uv

# Install comfy-cli and ComfyUI
RUN pip install --break-system-packages comfy-cli && \
    comfy --skip-prompt install --nvidia --cuda-version 12.6 --version nightly

# Set ComfyUI directory
ENV COMFYUI_DIR=/comfyui
WORKDIR /comfyui

# Install custom nodes
COPY config/custom_nodes.txt /app/config/custom_nodes.txt
COPY scripts/install_custom_nodes.sh /app/scripts/install_custom_nodes.sh
RUN chmod +x /app/scripts/install_custom_nodes.sh && \
    /app/scripts/install_custom_nodes.sh /app/config/custom_nodes.txt

# Install handler dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --break-system-packages -r /app/requirements.txt

# Copy application code
COPY handler.py /app/handler.py
COPY start.sh /start.sh
COPY config/ /app/config/
RUN chmod +x /start.sh

# Stage 2: Download models
FROM base AS downloader

COPY config/models.yaml /app/config/models.yaml
COPY scripts/download_models.py /app/scripts/download_models.py

ENV COMFYUI_MODELS_DIR=/comfyui/models

# Use Docker secret for HF token to avoid leaking in image layers
RUN --mount=type=secret,id=HF_TOKEN \
    HF_TOKEN=$(cat /run/secrets/HF_TOKEN 2>/dev/null || echo "") \
    python /app/scripts/download_models.py

# Stage 3: Final image with models
FROM base AS final

COPY --from=downloader /comfyui/models /comfyui/models

CMD ["/start.sh"]
