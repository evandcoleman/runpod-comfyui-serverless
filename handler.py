"""RunPod serverless handler for ComfyUI workflows."""

import base64
import io
import json
import os
import time
import urllib.parse
import urllib.request
import uuid

import boto3
import requests
import runpod
import websocket

COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_input(job_input: dict) -> tuple[dict | None, str | None]:
    """Validate job input. Returns (validated_input, error_message)."""
    if not job_input:
        return None, "No input provided"

    workflow = job_input.get("workflow")
    if not workflow:
        return None, "Missing 'workflow' field"

    if not isinstance(workflow, dict):
        return None, "'workflow' must be a JSON object (ComfyUI API format)"

    images = job_input.get("images", [])
    if images and not isinstance(images, list):
        return None, "'images' must be a list"

    for i, img in enumerate(images):
        if not isinstance(img, dict):
            return None, f"images[{i}] must be an object with 'name' and 'image' fields"
        if "name" not in img or "image" not in img:
            return None, f"images[{i}] missing 'name' or 'image' field"

    s3_config = job_input.get("s3")
    if s3_config:
        required_s3 = ["bucket", "access_key", "secret_key"]
        for key in required_s3:
            if key not in s3_config:
                return None, f"s3 config missing '{key}'"

    return job_input, None


# ---------------------------------------------------------------------------
# ComfyUI server interaction
# ---------------------------------------------------------------------------

def check_server(url: str = COMFYUI_URL, retries: int = 500, delay: float = 0.05) -> bool:
    """Poll ComfyUI server until it's ready."""
    for i in range(retries):
        try:
            resp = requests.get(f"{url}/system_stats", timeout=2)
            if resp.status_code == 200:
                return True
        except requests.ConnectionError:
            pass
        time.sleep(delay)
    return False


def upload_images(images: list[dict], url: str = COMFYUI_URL):
    """Upload base64-encoded images to ComfyUI."""
    for img in images:
        name = img["name"]
        data = base64.b64decode(img["image"])
        files = {"image": (name, io.BytesIO(data), "image/png")}
        body = {"overwrite": "true"}

        resp = requests.post(f"{url}/upload/image", files=files, data=body, timeout=30)
        resp.raise_for_status()


def queue_workflow(workflow: dict, client_id: str, url: str = COMFYUI_URL) -> str:
    """Submit a workflow to ComfyUI. Returns prompt_id."""
    payload = {"prompt": workflow, "client_id": client_id}
    resp = requests.post(f"{url}/prompt", json=payload, timeout=30)

    if resp.status_code != 200:
        try:
            error_detail = resp.json()
        except Exception:
            error_detail = resp.text
        raise RuntimeError(f"ComfyUI rejected workflow: {error_detail}")

    return resp.json()["prompt_id"]


def get_history(prompt_id: str, url: str = COMFYUI_URL) -> dict:
    """Get execution history for a prompt."""
    resp = requests.get(f"{url}/history/{prompt_id}", timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_image(filename: str, subfolder: str, image_type: str, url: str = COMFYUI_URL) -> bytes:
    """Fetch an output image from ComfyUI."""
    params = urllib.parse.urlencode({
        "filename": filename,
        "subfolder": subfolder,
        "type": image_type,
    })
    resp = requests.get(f"{url}/view?{params}", timeout=60)
    resp.raise_for_status()
    return resp.content


# ---------------------------------------------------------------------------
# S3 upload
# ---------------------------------------------------------------------------

def upload_to_s3(image_bytes: bytes, filename: str, s3_config: dict) -> str:
    """Upload image bytes to S3 and return the URL."""
    s3 = boto3.client(
        "s3",
        region_name=s3_config.get("region", "us-east-1"),
        aws_access_key_id=s3_config["access_key"],
        aws_secret_access_key=s3_config["secret_key"],
    )

    prefix = s3_config.get("prefix", "")
    key = f"{prefix}{filename}" if prefix else filename
    bucket = s3_config["bucket"]
    region = s3_config.get("region", "us-east-1")

    content_type = "image/png"
    if filename.lower().endswith(".jpg") or filename.lower().endswith(".jpeg"):
        content_type = "image/jpeg"
    elif filename.lower().endswith(".webp"):
        content_type = "image/webp"

    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=image_bytes,
        ContentType=content_type,
    )

    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


# ---------------------------------------------------------------------------
# WebSocket monitoring
# ---------------------------------------------------------------------------

def connect_ws(client_id: str, url: str = COMFYUI_URL, timeout: int = 600):
    """Connect a WebSocket to ComfyUI for a given client_id."""
    ws_url = url.replace("http://", "ws://").replace("https://", "wss://")
    return websocket.create_connection(
        f"{ws_url}/ws?clientId={client_id}",
        timeout=timeout,
    )


def wait_for_completion(ws, prompt_id: str, timeout: int = 600) -> bool:
    """Wait on an existing WebSocket connection for workflow completion."""
    try:
        start = time.time()
        while time.time() - start < timeout:
            message = ws.recv()
            if isinstance(message, str):
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "executing":
                    exec_data = data.get("data", {})
                    if exec_data.get("prompt_id") == prompt_id and exec_data.get("node") is None:
                        return True

                elif msg_type == "execution_error":
                    error_data = data.get("data", {})
                    raise RuntimeError(
                        f"ComfyUI execution error: {error_data.get('exception_message', 'Unknown error')}"
                    )

        raise TimeoutError(f"Workflow did not complete within {timeout}s")
    finally:
        ws.close()


# ---------------------------------------------------------------------------
# Output collection
# ---------------------------------------------------------------------------

def collect_outputs(prompt_id: str, s3_config: dict | None = None, url: str = COMFYUI_URL) -> list[dict]:
    """Collect output images from a completed workflow."""
    history = get_history(prompt_id, url)
    prompt_history = history.get(prompt_id, {})
    outputs = prompt_history.get("outputs", {})

    results = []

    for node_id, node_output in outputs.items():
        images = node_output.get("images", [])
        for img_info in images:
            filename = img_info["filename"]
            subfolder = img_info.get("subfolder", "")
            img_type = img_info.get("type", "output")

            image_bytes = get_image(filename, subfolder, img_type, url)

            if s3_config:
                s3_url = upload_to_s3(image_bytes, filename, s3_config)
                results.append({"filename": filename, "url": s3_url})
            else:
                b64 = base64.b64encode(image_bytes).decode("utf-8")
                results.append({"filename": filename, "data": b64})

    return results


# ---------------------------------------------------------------------------
# Main handler
# ---------------------------------------------------------------------------

def handler(job: dict):
    """RunPod serverless handler function (generator for streaming progress)."""
    job_input = job.get("input", {})

    # Validate
    validated, error = validate_input(job_input)
    if error:
        yield {"error": error}
        return

    workflow = validated["workflow"]
    images = validated.get("images", [])
    s3_config = validated.get("s3")

    # Pre-compute node metadata for progress reporting
    total_nodes = len(workflow)
    node_types = {nid: node.get("class_type", "Unknown") for nid, node in workflow.items()}

    # Wait for ComfyUI — yield periodic updates so the frontend stays alive
    server_ready = False
    wait_start = time.time()
    for attempt in range(500):
        try:
            resp = requests.get(f"{COMFYUI_URL}/system_stats", timeout=2)
            if resp.status_code == 200:
                server_ready = True
                break
        except requests.ConnectionError:
            pass
        # Yield an update every ~1s (every 20 attempts at 0.05s delay)
        if attempt % 20 == 0:
            elapsed_wait = round(time.time() - wait_start, 1)
            yield {
                "status": "waiting",
                "message": f"Waiting for ComfyUI server... ({elapsed_wait}s)",
                "elapsed": elapsed_wait,
            }
        time.sleep(0.05)

    if not server_ready:
        yield {"error": "ComfyUI server failed to start"}
        return

    yield {"status": "waiting", "message": "ComfyUI server ready", "elapsed": round(time.time() - wait_start, 1)}

    # Upload input images if provided
    if images:
        yield {"status": "uploading", "message": f"Uploading {len(images)} input image(s)..."}
        try:
            upload_images(images)
        except Exception as e:
            yield {"error": f"Failed to upload images: {e}"}
            return

    # Connect WebSocket before queueing to avoid missing completion events
    client_id = str(uuid.uuid4())
    try:
        ws = connect_ws(client_id)
    except Exception as e:
        yield {"error": f"Failed to connect WebSocket: {e}"}
        return

    # Queue the workflow
    yield {"status": "queued", "message": "Submitting workflow to ComfyUI...", "total_nodes": total_nodes}
    try:
        prompt_id = queue_workflow(workflow, client_id)
    except RuntimeError as e:
        ws.close()
        yield {"error": str(e)}
        return

    # Stream progress from WebSocket
    try:
        exec_start = time.time()
        timeout = 600
        current_node = None
        nodes_done = 0
        while time.time() - exec_start < timeout:
            message = ws.recv()
            if isinstance(message, str):
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "execution_start":
                    exec_data = data.get("data", {})
                    if exec_data.get("prompt_id") == prompt_id:
                        exec_start = time.time()
                        yield {
                            "status": "executing",
                            "message": "Execution started",
                            "total_nodes": total_nodes,
                            "elapsed": 0,
                        }

                elif msg_type == "progress":
                    prog = data.get("data", {})
                    yield {
                        "status": "running",
                        "node": current_node,
                        "node_type": node_types.get(current_node, "Unknown"),
                        "node_index": nodes_done,
                        "total_nodes": total_nodes,
                        "progress": prog.get("value", 0),
                        "max": prog.get("max", 0),
                        "elapsed": round(time.time() - exec_start, 1),
                    }

                elif msg_type == "executing":
                    exec_data = data.get("data", {})
                    if exec_data.get("prompt_id") != prompt_id:
                        continue
                    node = exec_data.get("node")
                    if node is None:
                        break  # Workflow complete
                    current_node = node
                    nodes_done += 1
                    yield {
                        "status": "running",
                        "message": f"Executing {node_types.get(node, 'node')}...",
                        "node": node,
                        "node_type": node_types.get(node, "Unknown"),
                        "node_index": nodes_done,
                        "total_nodes": total_nodes,
                        "elapsed": round(time.time() - exec_start, 1),
                    }

                elif msg_type == "execution_error":
                    error_data = data.get("data", {})
                    yield {"error": f"ComfyUI execution error: {error_data.get('exception_message', 'Unknown error')}"}
                    return

                elif msg_type == "execution_cached":
                    cached = data.get("data", {})
                    nodes = cached.get("nodes", [])
                    if nodes:
                        nodes_done += len(nodes)
                        yield {
                            "status": "running",
                            "message": f"Cached {len(nodes)} node(s)",
                            "node_index": nodes_done,
                            "total_nodes": total_nodes,
                            "elapsed": round(time.time() - exec_start, 1),
                        }
        else:
            yield {"error": f"Workflow did not complete within {timeout}s"}
            return
    finally:
        ws.close()

    # Collect results
    yield {"status": "collecting", "message": "Collecting output images..."}
    try:
        results = collect_outputs(prompt_id, s3_config)
    except Exception as e:
        yield {"error": f"Failed to collect outputs: {e}"}
        return

    if not results:
        yield {"error": "No output images produced"}
        return

    yield {"images": results}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler, "return_aggregate_stream": True})
