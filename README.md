# RunPod Serverless ComfyUI Worker

A RunPod serverless template that accepts ComfyUI workflow JSON (API format), executes it, and returns output images. Ships with Z-Image-Turbo BF16 as the default model.

## Quick Start

### 1. Build the Docker image

```bash
docker build -t comfyui-worker .
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

### Streaming Progress

The handler yields progress chunks via RunPod's streaming API (`/stream/{jobId}`). Each chunk is a JSON object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Current phase: `waiting`, `uploading`, `queued`, `executing`, `running`, `collecting` |
| `message` | string | Human-readable status message |
| `node` | string | Current ComfyUI node ID |
| `node_type` | string | Node class type (e.g. `KSampler`, `VAEDecode`) |
| `node_index` | number | Number of nodes completed so far |
| `total_nodes` | number | Total nodes in the workflow |
| `progress` | number | Current step within a node (e.g. sampler step 5) |
| `max` | number | Total steps within a node (e.g. 20 sampler steps) |
| `elapsed` | number | Seconds since execution started (server-side) |
| `error` | string | Error message if something failed |

Not all fields are present in every chunk. For example, `progress`/`max` only appear during nodes that report step-level progress (like KSampler), and `node_type`/`node_index` only appear during execution.

**Phase progression:** `waiting` &rarr; `uploading` (if images provided) &rarr; `queued` &rarr; `executing` &rarr; `running` (per-node) &rarr; `collecting` &rarr; final output

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

Add entries to `config/custom_nodes.txt` (one per line). Use a full URL for git repos, or a package name for the comfy-cli registry:

```
https://github.com/user/repo
comfyui-impact-pack
```

They'll be cloned (URLs) or installed via `comfy-cli` (package names) during the Docker build.

## ComfyUI "Run on Cloud" Extension

A built-in ComfyUI extension that adds a **Run on Cloud** button directly to the UI toolbar. Click it to submit the current workflow to your RunPod endpoint and stream progress in real time — no export/CLI step needed.

### Installation

```bash
# Symlink into your ComfyUI custom_nodes directory
cd /path/to/ComfyUI/custom_nodes
ln -s /path/to/runpod-comfyui-serverless/comfyui-runpod-cloud .

# Or for the Docker image, it's already included
```

Then restart ComfyUI.

### Configuration

1. Open ComfyUI in your browser
2. Go to **Settings** (gear icon)
3. Find **RunPod Cloud** in the settings categories
4. Set **RunPod Endpoint URL** (e.g. `https://api.runpod.ai/v2/your-endpoint-id`)
5. Set **RunPod API Key**

### Usage

1. Build your workflow as usual
2. Click **Run on Cloud** in the top toolbar (or use the RunPod menu)
3. A progress overlay appears in the bottom-right with:
   - **Phase label** — color-coded: Waiting for Server &rarr; Queued &rarr; Executing &rarr; Collecting &rarr; Saving &rarr; Done
   - **Overall progress bar** — tracks nodes completed out of total (animated indeterminate during cold start)
   - **Step progress bar** — shows within-node progress (e.g. KSampler steps), only visible when applicable
   - **Status line** — human-readable node type and count (e.g. "KSampler (3 of 12)")
   - **Elapsed time and ETA** — server-side elapsed time, with estimated time remaining after 2+ nodes complete
4. When complete, a fullscreen gallery displays the output images

## Running Workflows (CLI)

Use `run_workflow.py` to submit a workflow to your RunPod endpoint and stream progress in real time:

```bash
export RUNPOD_API_KEY="your-api-key"
python run_workflow.py path/to/workflow.json
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `-o`, `--output-dir` | `./output` | Directory to save output images |
| `--endpoint` | Built-in default | Override the API endpoint |
| `--api-key` | `$RUNPOD_API_KEY` | RunPod API key |

The workflow JSON must be in ComfyUI **API format**. See [Getting the Workflow JSON](#getting-the-workflow-json).

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
