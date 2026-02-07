import { app } from "../../scripts/app.js";

const POLL_INTERVAL = 500;
const POLL_TIMEOUT = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
.runpod-overlay {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 360px;
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  z-index: 10000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e0e0e0;
  overflow: hidden;
}

.runpod-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #2a2a2a;
  border-bottom: 1px solid #444;
  font-weight: 600;
  font-size: 13px;
}

.runpod-overlay-close {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
}
.runpod-overlay-close:hover { color: #fff; }

.runpod-overlay-body {
  padding: 12px 14px;
}

.runpod-progress-bar-track {
  width: 100%;
  height: 6px;
  background: #333;
  border-radius: 3px;
  margin: 8px 0;
  overflow: hidden;
}

.runpod-progress-bar-fill {
  height: 100%;
  background: #4a9eff;
  border-radius: 3px;
  transition: width 0.2s ease;
  width: 0%;
}

.runpod-status-text {
  font-size: 12px;
  color: #aaa;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.runpod-overlay.success .runpod-overlay-header { background: #1a3a1a; }
.runpod-overlay.error .runpod-overlay-header { background: #3a1a1a; }

/* Gallery */
.runpod-gallery-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
}

.runpod-gallery {
  background: #1e1e1e;
  border-radius: 10px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  padding: 20px;
  position: relative;
}

.runpod-gallery-close {
  position: absolute;
  top: 10px;
  right: 14px;
  background: none;
  border: none;
  color: #888;
  font-size: 24px;
  cursor: pointer;
  z-index: 1;
}
.runpod-gallery-close:hover { color: #fff; }

.runpod-gallery-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: center;
}

.runpod-gallery-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.runpod-gallery-item img {
  max-width: 512px;
  max-height: 512px;
  border-radius: 6px;
  object-fit: contain;
  background: #111;
}

.runpod-gallery-item a {
  color: #4a9eff;
  font-size: 12px;
  text-decoration: none;
}
.runpod-gallery-item a:hover { text-decoration: underline; }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById("runpod-cloud-styles")) return;
  const el = document.createElement("style");
  el.id = "runpod-cloud-styles";
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function getSetting(id) {
  // ComfyUI stores settings in localStorage under "Comfy.Settings.{id}"
  const val = localStorage.getItem(`Comfy.Settings.${id}`);
  if (val === null) return "";
  try { return JSON.parse(val); } catch { return val; }
}

// ---------------------------------------------------------------------------
// Progress Overlay
// ---------------------------------------------------------------------------

function createOverlay() {
  removeOverlay();
  const overlay = document.createElement("div");
  overlay.className = "runpod-overlay";
  overlay.id = "runpod-overlay";
  overlay.innerHTML = `
    <div class="runpod-overlay-header">
      <span>RunPod Cloud</span>
      <button class="runpod-overlay-close" title="Close">&times;</button>
    </div>
    <div class="runpod-overlay-body">
      <div class="runpod-progress-bar-track">
        <div class="runpod-progress-bar-fill"></div>
      </div>
      <div class="runpod-status-text">Submitting workflow...</div>
    </div>
  `;
  overlay.querySelector(".runpod-overlay-close").addEventListener("click", removeOverlay);
  document.body.appendChild(overlay);
  return overlay;
}

function removeOverlay() {
  document.getElementById("runpod-overlay")?.remove();
}

function updateOverlay(message, progress = null) {
  const overlay = document.getElementById("runpod-overlay");
  if (!overlay) return;
  const statusEl = overlay.querySelector(".runpod-status-text");
  const fillEl = overlay.querySelector(".runpod-progress-bar-fill");
  if (statusEl && message) statusEl.textContent = message;
  if (fillEl && progress !== null) {
    fillEl.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
}

function setOverlayState(state) {
  const overlay = document.getElementById("runpod-overlay");
  if (!overlay) return;
  overlay.classList.remove("success", "error");
  if (state) overlay.classList.add(state);
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function showGallery(images) {
  const backdrop = document.createElement("div");
  backdrop.className = "runpod-gallery-backdrop";
  backdrop.id = "runpod-gallery-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const gallery = document.createElement("div");
  gallery.className = "runpod-gallery";
  gallery.innerHTML = `<button class="runpod-gallery-close" title="Close">&times;</button>`;
  gallery.querySelector(".runpod-gallery-close").addEventListener("click", () => backdrop.remove());

  const grid = document.createElement("div");
  grid.className = "runpod-gallery-grid";

  for (const img of images) {
    const item = document.createElement("div");
    item.className = "runpod-gallery-item";

    const imgEl = document.createElement("img");
    if (img.url) {
      imgEl.src = img.url;
    } else if (img.data) {
      imgEl.src = `data:image/png;base64,${img.data}`;
    }
    imgEl.alt = img.filename || "Output";

    const link = document.createElement("a");
    link.textContent = `Save ${img.filename || "image"}`;
    link.download = img.filename || "output.png";
    if (img.url) {
      link.href = img.url;
      link.target = "_blank";
    } else if (img.data) {
      link.href = `data:image/png;base64,${img.data}`;
    }

    item.appendChild(imgEl);
    item.appendChild(link);
    grid.appendChild(item);
  }

  gallery.appendChild(grid);
  backdrop.appendChild(gallery);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

async function submitWorkflow(endpointUrl, apiKey, workflow) {
  const resp = await fetch(`${endpointUrl}/run`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: { workflow } }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Submit failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  if (!data.id) throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
  return data.id;
}

async function pollStream(endpointUrl, apiKey, jobId) {
  const headers = { "Authorization": `Bearer ${apiKey}` };
  const seenIndices = new Set();
  const start = Date.now();
  let finalOutput = null;

  while (Date.now() - start < POLL_TIMEOUT) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);

    // Poll stream
    try {
      const streamResp = await fetch(`${endpointUrl}/stream/${jobId}`, { headers });
      if (streamResp.ok) {
        const streamData = await streamResp.json();
        const stream = streamData.stream || [];

        for (const chunk of stream) {
          const idx = chunk.index;
          if (seenIndices.has(idx)) continue;
          seenIndices.add(idx);

          const output = chunk.output || {};

          if (output.error) {
            setOverlayState("error");
            updateOverlay(`Error: ${output.error}`);
            return null;
          }

          if (output.images) {
            finalOutput = output;
            continue;
          }

          const progress = output.progress;
          const max = output.max;
          const message = output.message;
          const status = output.status;
          const node = output.node;

          if (progress != null && max) {
            const pct = (progress / max) * 100;
            updateOverlay(`[${elapsed}s] Node ${node || "?"}: ${pct.toFixed(0)}%`, pct);
          } else if (message) {
            updateOverlay(`[${elapsed}s] ${message}`);
          } else if (status) {
            updateOverlay(`[${elapsed}s] ${status}`);
          }
        }
      }
    } catch (e) {
      // Stream endpoint may 404 early on, ignore and retry
    }

    if (finalOutput) return finalOutput;

    // Check job status
    try {
      const statusResp = await fetch(`${endpointUrl}/status/${jobId}`, { headers });
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        const jobStatus = statusData.status;

        if (jobStatus === "COMPLETED") {
          if (finalOutput) return finalOutput;
          // Check aggregated output
          const agg = statusData.output;
          if (Array.isArray(agg)) {
            for (let i = agg.length - 1; i >= 0; i--) {
              if (agg[i] && (agg[i].images || agg[i].error)) {
                return agg[i];
              }
            }
            return agg[agg.length - 1] || { error: "No output" };
          }
          return agg || { error: "No output" };
        }

        if (jobStatus === "FAILED") {
          setOverlayState("error");
          updateOverlay(`Job failed after ${elapsed}s`);
          return null;
        }
      }
    } catch (e) {
      // Status check failed, retry
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  setOverlayState("error");
  updateOverlay("Timed out waiting for results");
  return null;
}

// ---------------------------------------------------------------------------
// Main execution flow
// ---------------------------------------------------------------------------

let running = false;

async function runOnCloud() {
  if (running) return;

  const endpointUrl = getSetting("runpod_cloud.endpoint_url")?.replace(/\/+$/, "");
  const apiKey = getSetting("runpod_cloud.api_key");

  if (!endpointUrl || !apiKey) {
    alert(
      "RunPod Cloud is not configured.\n\n" +
      "Go to Settings > RunPod Cloud and set your endpoint URL and API key."
    );
    return;
  }

  let prompt;
  try {
    const graphData = await app.graphToPrompt();
    prompt = graphData.output;
  } catch (e) {
    alert(`Failed to serialize workflow: ${e.message}`);
    return;
  }

  running = true;
  injectStyles();
  createOverlay();

  try {
    updateOverlay("Submitting workflow...");
    const jobId = await submitWorkflow(endpointUrl, apiKey, prompt);
    updateOverlay(`Job submitted: ${jobId.slice(0, 12)}...`);

    const result = await pollStream(endpointUrl, apiKey, jobId);

    if (result && result.images && result.images.length > 0) {
      setOverlayState("success");
      updateOverlay(`Done — ${result.images.length} image(s)`, 100);
      showGallery(result.images);
    } else if (result && result.error) {
      setOverlayState("error");
      updateOverlay(`Error: ${result.error}`);
    } else if (!result) {
      // Error already shown by pollStream
    } else {
      setOverlayState("error");
      updateOverlay("No images in output");
    }
  } catch (e) {
    setOverlayState("error");
    updateOverlay(`Error: ${e.message}`);
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

app.registerExtension({
  name: "runpod.cloud",

  init() {
    injectStyles();
  },

  setup() {
    // Register settings
    app.ui.settings.addSetting({
      id: "runpod_cloud.endpoint_url",
      name: "RunPod Endpoint URL",
      type: "text",
      defaultValue: "",
      tooltip: "Full RunPod serverless endpoint URL (e.g. https://api.runpod.ai/v2/your-endpoint-id)",
      category: ["RunPod Cloud", "Connection"],
    });

    app.ui.settings.addSetting({
      id: "runpod_cloud.api_key",
      name: "RunPod API Key",
      type: "text",
      defaultValue: "",
      tooltip: "Your RunPod API key",
      category: ["RunPod Cloud", "Connection"],
    });

    // Add toolbar button
    const btn = document.createElement("button");
    btn.id = "runpod-cloud-btn";
    btn.textContent = "Run on Cloud";
    btn.title = "Submit workflow to RunPod serverless endpoint";
    btn.style.cssText = `
      font-size: 13px;
      padding: 4px 12px;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid #555;
      background: #2a2a2a;
      color: #e0e0e0;
    `;
    btn.addEventListener("mouseenter", () => { btn.style.background = "#3a3a3a"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "#2a2a2a"; });
    btn.addEventListener("click", runOnCloud);

    // Try multiple selectors for different ComfyUI versions
    const selectors = [
      ".comfyui-menu .comfyui-menu-right",
      ".comfy-menu-btns",
      ".comfyui-body-top .comfyui-menu",
    ];

    let injected = false;
    for (const sel of selectors) {
      const target = document.querySelector(sel);
      if (target) {
        target.prepend(btn);
        injected = true;
        break;
      }
    }

    // Fallback: retry after DOM settles
    if (!injected) {
      const observer = new MutationObserver((_mutations, obs) => {
        for (const sel of selectors) {
          const target = document.querySelector(sel);
          if (target) {
            target.prepend(btn);
            obs.disconnect();
            return;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      // Stop observing after 10s to avoid leaks
      setTimeout(() => observer.disconnect(), 10000);
    }

    // Register as a menu command if the API supports it
    if (app.registerExtension?.menuCommands || app.ui?.menu) {
      try {
        app.ui?.menu?.addCommand?.("RunPod", "Run on Cloud", runOnCloud);
      } catch {
        // Older ComfyUI versions may not support this
      }
    }
  },
});
