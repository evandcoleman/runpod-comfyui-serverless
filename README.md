# RunPod Serverless ComfyUI Worker

A RunPod serverless template that accepts ComfyUI workflow JSON (API format), executes it, and returns output images. Ships with Z-Image-Turbo BF16 as the default model.

## Quick Start

### 1. Build the Docker image

```bash
# Build with models baked in
docker build --target final -t comfyui-worker .

# Build with HuggingFace token for gated models
docker build --target final --build-arg HF_TOKEN=hf_xxx -t comfyui-worker .
```

### 2. Test locally (requires NVIDIA GPU)

```bash
docker compose up
```

Then in another terminal:

```bash
python test/test_local.py --http http://localhost:8000 test/test_input.json
```

### 3. Deploy to RunPod

1. Push the image to Docker Hub or a container registry
2. Create a new Serverless endpoint on RunPod using the image
3. Send requests via the RunPod API

## API Reference

### Input

```json
{
  "input": {
    "workflow": { ... },
    "images": [
      { "name": "input.png", "image": "<base64>" }
    ],
    "s3": {
      "bucket": "my-bucket",
      "region": "us-east-1",
      "access_key": "...",
      "secret_key": "...",
      "prefix": "outputs/"
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `workflow` | Yes | ComfyUI workflow in API format |
| `images` | No | Input images for img2img workflows |
| `s3` | No | S3 config to upload outputs instead of returning base64 |

### Output (base64 mode)

```json
{
  "images": [
    { "filename": "ComfyUI_00001_.png", "data": "<base64>" }
  ]
}
```

### Output (S3 mode)

```json
{
  "images": [
    { "filename": "ComfyUI_00001_.png", "url": "https://bucket.s3.region.amazonaws.com/..." }
  ]
}
```

## Getting the Workflow JSON

ComfyUI workflows must be in **API format**, not the standard UI format.

1. Open ComfyUI in your browser
2. Build your workflow
3. Enable **Dev Mode** in settings
4. Click **Save (API Format)** to export

## Configuration

### Adding Models

Edit `config/models.yaml` to add models downloaded at build time:

```yaml
models:
  - repo: stabilityai/stable-diffusion-xl-base-1.0
    files:
      - path: sd_xl_base_1.0.safetensors
        dest: checkpoints/
```

### Network Volume Models

Mount a RunPod network volume at `/runpod-volume` with models in subdirectories:

```
/runpod-volume/models/
├── checkpoints/
├── loras/
├── controlnet/
└── ...
```

The worker auto-detects the volume and configures ComfyUI to use it.

### Custom Nodes

Add custom node names to `config/custom_nodes.txt` (one per line):

```
comfyui-impact-pack
comfyui-manager
```

They'll be installed via `comfy-cli` during the Docker build.

## Local Testing

```bash
# Direct handler test (no Docker needed, but requires ComfyUI running locally)
python test/test_local.py test/test_input.json

# HTTP test against Docker container
python test/test_local.py --http http://localhost:8000 test/test_input.json

# RunPod endpoint test
python test/test_local.py --runpod <endpoint_id> --api-key <key> test/test_input.json
```

Output images are saved to `test/output/`.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| ComfyUI server timeout | Increase `check_server` retries or check GPU memory |
| Workflow rejected | Ensure workflow is in API format, not UI format |
| Model not found | Check model filename matches what's in the workflow |
| OOM errors | Reduce image resolution or batch size |
| S3 upload fails | Verify S3 credentials and bucket permissions |
