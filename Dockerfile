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

# Remove externally-managed-environment guard so comfy-cli's internal
# pip calls work without --break-system-packages
RUN rm -f /usr/lib/python3.12/EXTERNALLY-MANAGED

# Install uv for fast package management
RUN pip install uv

# Install comfy-cli and ComfyUI
RUN pip install comfy-cli && \
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
RUN pip install -r /app/requirements.txt

# Copy application code
COPY handler.py /app/handler.py
COPY start.sh /start.sh
COPY config/ /app/config/
RUN chmod +x /start.sh

CMD ["/start.sh"]
