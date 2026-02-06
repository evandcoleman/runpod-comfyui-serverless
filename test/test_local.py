#!/usr/bin/env python3
"""Local testing script for the ComfyUI RunPod handler.

Usage:
    # Direct handler test (import handler, no server needed):
    python test/test_local.py test/test_input.json

    # HTTP test against running container:
    python test/test_local.py --http http://localhost:8000 test/test_input.json

    # RunPod endpoint test:
    python test/test_local.py --runpod <endpoint_id> --api-key <key> test/test_input.json
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path


def save_images(results: list[dict], output_dir: Path):
    """Save result images to disk."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for img in results:
        filename = img["filename"]
        dest = output_dir / filename

        if "data" in img:
            data = base64.b64decode(img["data"])
            dest.write_bytes(data)
            print(f"  Saved: {dest} ({len(data)} bytes)")
        elif "url" in img:
            print(f"  S3 URL: {img['url']}")


def test_direct(payload: dict) -> dict:
    """Test by importing the handler directly."""
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from handler import handler

    job = {"id": "test-local", "input": payload["input"]}
    return handler(job)


def test_http(url: str, payload: dict) -> dict:
    """Test via HTTP against a running container."""
    import requests

    # RunPod test endpoint format
    resp = requests.post(
        f"{url.rstrip('/')}/runsync",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=300,
    )
    resp.raise_for_status()
    result = resp.json()

    if "output" in result:
        return result["output"]
    return result


def test_runpod(endpoint_id: str, api_key: str, payload: dict) -> dict:
    """Test via RunPod serverless API."""
    import requests

    url = f"https://api.runpod.ai/v2/{endpoint_id}/runsync"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    resp = requests.post(url, json=payload, headers=headers, timeout=300)
    resp.raise_for_status()
    result = resp.json()

    status = result.get("status")
    if status == "COMPLETED":
        return result.get("output", {})
    elif status == "IN_QUEUE" or status == "IN_PROGRESS":
        run_id = result["id"]
        print(f"Job queued: {run_id}, polling for completion...")
        return poll_runpod(endpoint_id, api_key, run_id)
    else:
        return result


def poll_runpod(endpoint_id: str, api_key: str, run_id: str, timeout: int = 300) -> dict:
    """Poll RunPod for job completion."""
    import requests

    url = f"https://api.runpod.ai/v2/{endpoint_id}/status/{run_id}"
    headers = {"Authorization": f"Bearer {api_key}"}

    start = time.time()
    while time.time() - start < timeout:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        result = resp.json()

        status = result.get("status")
        if status == "COMPLETED":
            return result.get("output", {})
        elif status == "FAILED":
            return {"error": result.get("error", "Job failed")}

        time.sleep(2)

    return {"error": f"Polling timed out after {timeout}s"}


def main():
    parser = argparse.ArgumentParser(description="Test ComfyUI RunPod handler")
    parser.add_argument("input_file", help="Path to test input JSON file")
    parser.add_argument("--http", help="HTTP URL of running container (e.g., http://localhost:8000)")
    parser.add_argument("--runpod", help="RunPod endpoint ID")
    parser.add_argument("--api-key", help="RunPod API key (or set RUNPOD_API_KEY env)")
    parser.add_argument("--output-dir", default="test/output", help="Directory to save output images")
    args = parser.parse_args()

    # Load test payload
    with open(args.input_file) as f:
        payload = json.load(f)

    print(f"Loaded workflow from {args.input_file}")

    # Run test
    start = time.time()

    if args.runpod:
        api_key = args.api_key or os.environ.get("RUNPOD_API_KEY")
        if not api_key:
            print("Error: --api-key or RUNPOD_API_KEY required for RunPod testing")
            sys.exit(1)
        print(f"Testing RunPod endpoint: {args.runpod}")
        result = test_runpod(args.runpod, api_key, payload)
    elif args.http:
        print(f"Testing HTTP endpoint: {args.http}")
        result = test_http(args.http, payload)
    else:
        print("Testing handler directly (import mode)")
        result = test_direct(payload)

    elapsed = time.time() - start

    # Handle results
    if "error" in result:
        print(f"\nError: {result['error']}")
        sys.exit(1)

    images = result.get("images", [])
    print(f"\nCompleted in {elapsed:.1f}s, got {len(images)} image(s)")

    if images:
        save_images(images, Path(args.output_dir))

    print("\nDone!")


if __name__ == "__main__":
    main()
