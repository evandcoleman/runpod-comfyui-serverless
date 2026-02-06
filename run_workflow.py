#!/usr/bin/env python3
"""Submit a ComfyUI workflow JSON to the RunPod serverless endpoint and stream progress."""

import argparse
import base64
import json
import os
import sys
import time

import requests

DEFAULT_ENDPOINT = "https://api.runpod.ai/v2/c6qgcj1se7mdh2"


def submit_workflow(endpoint: str, api_key: str, workflow: dict) -> str:
    """Submit a workflow and return the job ID."""
    resp = requests.post(
        f"{endpoint}/run",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"input": {"workflow": workflow}},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if "id" not in data:
        print(f"Unexpected response: {json.dumps(data, indent=2)}", file=sys.stderr)
        sys.exit(1)

    return data["id"]


def stream_progress(endpoint: str, api_key: str, job_id: str, interval: float = 0.5) -> dict:
    """Poll the /stream endpoint for progress updates. Returns the final output."""
    stream_url = f"{endpoint}/stream/{job_id}"
    status_url = f"{endpoint}/status/{job_id}"
    headers = {"Authorization": f"Bearer {api_key}"}
    start = time.time()
    seen_indices = set()
    final_output = None

    while True:
        elapsed = time.time() - start

        # Check stream for new chunks
        resp = requests.get(stream_url, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        stream = data.get("stream", [])
        for chunk in stream:
            idx = chunk.get("index")
            if idx in seen_indices:
                continue
            seen_indices.add(idx)

            output = chunk.get("output", {})

            if "error" in output:
                print(f"  [{elapsed:.0f}s] Error: {output['error']}", file=sys.stderr)
                sys.exit(1)

            if "images" in output:
                final_output = output
                continue

            status = output.get("status", "")
            message = output.get("message", "")
            progress = output.get("progress")
            max_progress = output.get("max")

            if progress is not None and max_progress:
                pct = progress / max_progress * 100
                node = output.get("node", "?")
                print(f"  [{elapsed:.0f}s] Node {node}: {pct:.0f}% ({progress}/{max_progress})", file=sys.stderr)
            elif message:
                print(f"  [{elapsed:.0f}s] {message}", file=sys.stderr)
            elif status:
                print(f"  [{elapsed:.0f}s] {status}", file=sys.stderr)

        # If we got the final images chunk from stream, we're done
        if final_output:
            return final_output

        # Check job status to know when to stop
        status_resp = requests.get(status_url, headers=headers, timeout=30)
        status_resp.raise_for_status()
        status_data = status_resp.json()
        job_status = status_data.get("status")

        if job_status == "COMPLETED":
            # Final output may be in the aggregated status response
            return final_output or status_data.get("output", {})
        elif job_status == "FAILED":
            print(f"Job failed after {elapsed:.0f}s:", file=sys.stderr)
            print(json.dumps(status_data, indent=2), file=sys.stderr)
            sys.exit(1)

        time.sleep(interval)


def save_images(output: dict, output_dir: str):
    """Save base64-encoded images from the output to disk."""
    images = output.get("images", [])
    if not images:
        print("No images in output.", file=sys.stderr)
        return

    os.makedirs(output_dir, exist_ok=True)

    for img in images:
        filename = img.get("filename", "output.png")
        filepath = os.path.join(output_dir, filename)

        if "url" in img:
            print(f"  {filename}: {img['url']}", file=sys.stderr)
        elif "data" in img:
            image_bytes = base64.b64decode(img["data"])
            with open(filepath, "wb") as f:
                f.write(image_bytes)
            print(f"  Saved: {filepath}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Run a ComfyUI workflow on RunPod")
    parser.add_argument("workflow", help="Path to the workflow JSON file")
    parser.add_argument("-o", "--output-dir", default="./output", help="Directory to save output images (default: ./output)")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="RunPod endpoint URL")
    parser.add_argument("--api-key", default=os.environ.get("RUNPOD_API_KEY"), help="RunPod API key (or set RUNPOD_API_KEY env var)")
    args = parser.parse_args()

    if not args.api_key:
        print("Error: Provide --api-key or set RUNPOD_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    with open(args.workflow) as f:
        workflow = json.load(f)

    print(f"Submitting workflow: {args.workflow}", file=sys.stderr)
    job_id = submit_workflow(args.endpoint, args.api_key, workflow)
    print(f"Job ID: {job_id}", file=sys.stderr)

    output = stream_progress(args.endpoint, args.api_key, job_id)

    if "error" in output:
        print(f"Error: {output['error']}", file=sys.stderr)
        sys.exit(1)

    save_images(output, args.output_dir)
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
