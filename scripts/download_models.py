#!/usr/bin/env python3
"""Download models declared in config/models.yaml to ComfyUI model directories."""

import os
import sys
from pathlib import Path

import requests
import yaml

COMFYUI_MODELS_DIR = Path("/comfyui/models")
NETWORK_VOLUME_MODELS_DIR = Path("/runpod-volume/models")
MANIFEST_PATH = Path(__file__).parent.parent / "config" / "models.yaml"
CHUNK_SIZE = 8 * 1024 * 1024  # 8 MB


def file_exists_on_volume(dest_subdir: str, filename: str) -> bool:
    """Check if a model file exists on the network volume."""
    volume_path = NETWORK_VOLUME_MODELS_DIR / dest_subdir / filename
    if volume_path.exists():
        print(f"  [volume] {filename} found at {volume_path}")
        return True
    return False


def download_file(url: str, dest: Path, headers: dict | None = None):
    """Download a file with progress reporting. Skips if already exists."""
    if dest.exists():
        print(f"  [skip] {dest} already exists")
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")

    print(f"  [download] {url}")
    print(f"         -> {dest}")

    resp = requests.get(url, headers=headers, stream=True, timeout=300)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0

    with open(tmp, "wb") as f:
        for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                print(f"\r  {downloaded / 1e9:.2f}/{total / 1e9:.2f} GB ({pct:.1f}%)", end="", flush=True)

    if total:
        print()

    tmp.rename(dest)
    print(f"  [done] {dest.name}")


def build_hf_url(repo: str, filepath: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/main/{filepath}"


def main():
    models_dir = Path(os.environ.get("COMFYUI_MODELS_DIR", COMFYUI_MODELS_DIR))
    manifest = Path(os.environ.get("MODELS_MANIFEST", MANIFEST_PATH))

    if not manifest.exists():
        print(f"No manifest found at {manifest}, skipping model download")
        return

    with open(manifest) as f:
        config = yaml.safe_load(f)

    if not config or "models" not in config:
        print("No models defined in manifest")
        return

    headers = {}
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
        print("Using HuggingFace auth token")

    has_volume = NETWORK_VOLUME_MODELS_DIR.is_dir()
    if has_volume:
        print(f"Network volume detected at {NETWORK_VOLUME_MODELS_DIR}")
    else:
        print("No network volume detected, will download all models")

    for model in config["models"]:
        repo = model["repo"]
        print(f"\nModel repo: {repo}")

        for file_entry in model["files"]:
            filepath = file_entry["path"]
            dest_subdir = file_entry["dest"]
            filename = Path(filepath).name

            # Skip download if file exists on network volume
            if has_volume and file_exists_on_volume(dest_subdir, filename):
                continue

            dest = models_dir / dest_subdir / filename
            url = build_hf_url(repo, filepath)

            try:
                download_file(url, dest, headers=headers or None)
            except requests.HTTPError as e:
                print(f"  [error] Failed to download {filename}: {e}", file=sys.stderr)
                sys.exit(1)

    print("\nAll models ready")


if __name__ == "__main__":
    main()
