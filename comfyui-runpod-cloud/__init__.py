"""ComfyUI extension that adds a 'Run on Cloud' button to submit workflows to RunPod."""

import base64
import os

import folder_paths
from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def _unique_path(directory, filename):
    """Return a path in directory that doesn't overwrite an existing file."""
    name, ext = os.path.splitext(filename)
    candidate = os.path.join(directory, filename)
    counter = 1
    while os.path.exists(candidate):
        candidate = os.path.join(directory, f"{name}_{counter}{ext}")
        counter += 1
    return candidate


@PromptServer.instance.routes.post("/runpod/save")
async def save_image(request):
    data = await request.json()
    filename = data.get("filename", "output.png")
    image_b64 = data.get("data")
    image_url = data.get("url")

    if not image_b64 and not image_url:
        return web.json_response({"error": "No image data or URL provided"}, status=400)

    output_dir = folder_paths.get_output_directory()
    os.makedirs(output_dir, exist_ok=True)
    filepath = _unique_path(output_dir, filename)

    if image_b64:
        image_bytes = base64.b64decode(image_b64)
        with open(filepath, "wb") as f:
            f.write(image_bytes)
    elif image_url:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(image_url) as resp:
                if resp.status != 200:
                    return web.json_response(
                        {"error": f"Failed to download from URL: {resp.status}"},
                        status=502,
                    )
                image_bytes = await resp.read()
                with open(filepath, "wb") as f:
                    f.write(image_bytes)

    saved_name = os.path.basename(filepath)
    return web.json_response({"filename": saved_name, "path": filepath})
