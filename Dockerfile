FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_PREFER_BINARY=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV COMFYUI_DIR=/comfyui

# Install system dependencies, Python, comfy-cli, ComfyUI, and clean up in one layer
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
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.12 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
    && rm -f /usr/lib/python3.12/EXTERNALLY-MANAGED \
    && pip install comfy-cli \
    && comfy --workspace /comfyui --skip-prompt install --nvidia --cuda-version 12.6 --version nightly \
    && find /comfyui -type d -name ".git" -exec rm -rf {} + 2>/dev/null; \
    rm -rf /root/.cache /tmp/*

WORKDIR /comfyui

# Install custom nodes
COPY config/custom_nodes.txt /app/config/custom_nodes.txt
COPY scripts/install_custom_nodes.sh /app/scripts/install_custom_nodes.sh
RUN chmod +x /app/scripts/install_custom_nodes.sh && \
    /app/scripts/install_custom_nodes.sh /app/config/custom_nodes.txt && \
    find /comfyui/custom_nodes -type d -name ".git" -exec rm -rf {} + 2>/dev/null; \
    rm -rf /root/.cache /tmp/*

# Install handler dependencies and copy application code
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY handler.py /app/handler.py
COPY scripts/download_models.py /app/scripts/download_models.py
COPY start.sh /start.sh
COPY config/ /app/config/
RUN chmod +x /start.sh

CMD ["/start.sh"]
