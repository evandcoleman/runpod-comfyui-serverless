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

.runpod-phase {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.runpod-phase[data-phase="starting"]   { color: #f0ad4e; }
.runpod-phase[data-phase="executing"]  { color: #4a9eff; }
.runpod-phase[data-phase="collecting"] { color: #9b59b6; }
.runpod-phase[data-phase="saving"]     { color: #1abc9c; }
.runpod-phase[data-phase="done"]       { color: #5cb85c; }
.runpod-phase[data-phase="error"]      { color: #d9534f; }

.runpod-progress-label {
  font-size: 11px;
  color: #777;
  margin-bottom: 2px;
}

.runpod-progress-bar-track {
  width: 100%;
  height: 6px;
  background: #333;
  border-radius: 3px;
  margin-bottom: 6px;
  overflow: hidden;
}

.runpod-progress-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
  width: 0%;
}

.runpod-progress-bar-fill.overall { background: #4a9eff; }
.runpod-progress-bar-fill.step    { background: #5cb85c; }

.runpod-step-row {
  display: none;
}
.runpod-step-row.visible {
  display: block;
}

.runpod-status-text {
  font-size: 12px;
  color: #ccc;
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.runpod-meta-text {
  font-size: 11px;
  color: #777;
  margin-top: 4px;
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
  // Use the new extensionManager API if available, fall back to localStorage
  try {
    return app.extensionManager.setting.get(id);
  } catch {
    const val = localStorage.getItem(`Comfy.Settings.${id}`);
    if (val === null) return "";
    try { return JSON.parse(val); } catch { return val; }
  }
}

// ---------------------------------------------------------------------------
// Progress Overlay
// ---------------------------------------------------------------------------

// Progress tracking state (reset each run)
let progressState = {
  phase: "starting",
  nodesDone: 0,
  totalNodes: 0,
  elapsed: 0,
  nodeTimestamps: [],   // timestamps when each node completed, for ETA
  currentNodeType: "",
};

function resetProgressState() {
  progressState = {
    phase: "starting",
    nodesDone: 0,
    totalNodes: 0,
    elapsed: 0,
    nodeTimestamps: [],
    currentNodeType: "",
  };
}

function formatTime(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function computeEta() {
  const { nodeTimestamps, totalNodes, nodesDone } = progressState;
  if (nodeTimestamps.length < 2 || nodesDone >= totalNodes) return null;
  // Average interval between node completions
  let totalInterval = 0;
  for (let i = 1; i < nodeTimestamps.length; i++) {
    totalInterval += nodeTimestamps[i] - nodeTimestamps[i - 1];
  }
  const avgInterval = totalInterval / (nodeTimestamps.length - 1);
  const remaining = totalNodes - nodesDone;
  return Math.round(avgInterval * remaining);
}

function createOverlay() {
  removeOverlay();
  resetProgressState();
  const overlay = document.createElement("div");
  overlay.className = "runpod-overlay";
  overlay.id = "runpod-overlay";
  overlay.innerHTML = `
    <div class="runpod-overlay-header">
      <span>RunPod Cloud</span>
      <button class="runpod-overlay-close" title="Close">&times;</button>
    </div>
    <div class="runpod-overlay-body">
      <div class="runpod-phase" data-phase="starting">Starting</div>
      <div class="runpod-progress-label">Overall</div>
      <div class="runpod-progress-bar-track">
        <div class="runpod-progress-bar-fill overall"></div>
      </div>
      <div class="runpod-step-row">
        <div class="runpod-progress-label">Step</div>
        <div class="runpod-progress-bar-track">
          <div class="runpod-progress-bar-fill step"></div>
        </div>
      </div>
      <div class="runpod-status-text">Submitting workflow...</div>
      <div class="runpod-meta-text"></div>
    </div>
  `;
  overlay.querySelector(".runpod-overlay-close").addEventListener("click", removeOverlay);
  document.body.appendChild(overlay);
  return overlay;
}

function removeOverlay() {
  document.getElementById("runpod-overlay")?.remove();
}

function setPhase(phase, label) {
  const overlay = document.getElementById("runpod-overlay");
  if (!overlay) return;
  const phaseEl = overlay.querySelector(".runpod-phase");
  if (phaseEl) {
    phaseEl.dataset.phase = phase;
    phaseEl.textContent = label || phase;
  }
  progressState.phase = phase;
}

function updateOverlay(message, overallPct = null, stepPct = null) {
  const overlay = document.getElementById("runpod-overlay");
  if (!overlay) return;
  const statusEl = overlay.querySelector(".runpod-status-text");
  const overallFill = overlay.querySelector(".runpod-progress-bar-fill.overall");
  const stepFill = overlay.querySelector(".runpod-progress-bar-fill.step");
  const stepRow = overlay.querySelector(".runpod-step-row");
  const metaEl = overlay.querySelector(".runpod-meta-text");

  if (statusEl && message) statusEl.textContent = message;

  if (overallFill && overallPct !== null) {
    overallFill.style.width = `${Math.min(100, Math.max(0, overallPct))}%`;
  }

  if (stepRow && stepFill) {
    if (stepPct !== null) {
      stepRow.classList.add("visible");
      stepFill.style.width = `${Math.min(100, Math.max(0, stepPct))}%`;
    } else {
      stepRow.classList.remove("visible");
    }
  }

  // Update meta line (elapsed + ETA)
  if (metaEl) {
    const parts = [];
    if (progressState.elapsed > 0) {
      parts.push(`${formatTime(progressState.elapsed)} elapsed`);
    }
    const eta = computeEta();
    if (eta !== null) {
      parts.push(`~${formatTime(eta)} remaining`);
    }
    metaEl.textContent = parts.join(" \u2014 ");
  }
}

function setOverlayState(state) {
  const overlay = document.getElementById("runpod-overlay");
  if (!overlay) return;
  overlay.classList.remove("success", "error");
  if (state) overlay.classList.add(state);
  if (state === "error") setPhase("error", "Error");
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

    item.appendChild(imgEl);

    const label = document.createElement("span");
    label.style.cssText = "font-size: 12px; color: #aaa;";
    if (img.savedAs) {
      label.textContent = `Saved: ${img.savedAs}`;
      label.style.color = "#6c6";
    } else if (img.saveError) {
      label.textContent = `Save failed: ${img.saveError}`;
      label.style.color = "#c66";
    } else {
      label.textContent = img.filename || "output.png";
    }
    item.appendChild(label);
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

          // Update tracking state from enriched fields
          if (output.total_nodes) progressState.totalNodes = output.total_nodes;
          if (output.elapsed != null) progressState.elapsed = output.elapsed;

          if (output.node_index != null && output.node_index > progressState.nodesDone) {
            progressState.nodesDone = output.node_index;
            progressState.nodeTimestamps.push(Date.now() / 1000);
          }

          if (output.node_type) progressState.currentNodeType = output.node_type;

          // Phase transitions
          if (output.status === "executing" || output.status === "running") {
            if (progressState.phase === "starting") setPhase("executing", "Executing");
          } else if (output.status === "collecting") {
            setPhase("collecting", "Collecting");
          }

          // Calculate overall progress percentage
          const overallPct = progressState.totalNodes > 0
            ? (progressState.nodesDone / progressState.totalNodes) * 100
            : null;

          const progress = output.progress;
          const max = output.max;
          const nodeLabel = output.node_type || output.node || "?";

          if (progress != null && max) {
            const stepPct = (progress / max) * 100;
            const countStr = progressState.totalNodes
              ? ` (${progressState.nodesDone} of ${progressState.totalNodes})`
              : "";
            updateOverlay(
              `${nodeLabel}${countStr} \u2014 step ${progress}/${max}`,
              overallPct,
              stepPct,
            );
          } else if (output.message) {
            const countStr = progressState.totalNodes
              ? ` (${progressState.nodesDone} of ${progressState.totalNodes})`
              : "";
            updateOverlay(`${output.message}${countStr}`, overallPct, null);
          } else if (output.status) {
            updateOverlay(output.status, overallPct, null);
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
// Save images to ComfyUI output directory
// ---------------------------------------------------------------------------

async function saveImages(images) {
  const saved = [];
  for (const img of images) {
    try {
      const resp = await fetch("/runpod/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: img.filename || "output.png",
          data: img.data || undefined,
          url: img.url || undefined,
        }),
      });
      if (resp.ok) {
        const result = await resp.json();
        saved.push({ ...img, savedAs: result.filename, savedPath: result.path });
      } else {
        saved.push({ ...img, saveError: `Save failed (${resp.status})` });
      }
    } catch (e) {
      saved.push({ ...img, saveError: e.message });
    }
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Main execution flow
// ---------------------------------------------------------------------------

let running = false;

async function runOnCloud() {
  if (running) return;

  const endpointUrl = getSetting("RunPod.Connection.EndpointURL")?.replace(/\/+$/, "");
  const apiKey = getSetting("RunPod.Connection.APIKey");

  if (!endpointUrl || !apiKey) {
    alert(
      "RunPod Cloud is not configured.\n\n" +
      "Go to Settings and search for 'RunPod' to set your endpoint URL and API key."
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
      setPhase("saving", "Saving");
      updateOverlay(`Saving ${result.images.length} image(s)...`, 100, null);
      const saved = await saveImages(result.images);
      const successCount = saved.filter((s) => s.savedAs).length;
      setOverlayState("success");
      setPhase("done", "Done");
      updateOverlay(`Done — ${successCount} image(s) saved to output/`, 100, null);
      showGallery(saved);
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

const COMMAND_ID = "RunPod.RunOnCloud";

app.registerExtension({
  name: "runpod.cloud",

  // Settings registered via the settings array (new API)
  settings: [
    {
      id: "RunPod.Connection.EndpointURL",
      name: "Endpoint URL",
      type: "text",
      defaultValue: "",
      tooltip: "Full RunPod serverless endpoint URL (e.g. https://api.runpod.ai/v2/your-endpoint-id)",
      category: ["RunPod", "Connection", "Endpoint URL"],
    },
    {
      id: "RunPod.Connection.APIKey",
      name: "API Key",
      type: "text",
      defaultValue: "",
      tooltip: "Your RunPod API key",
      category: ["RunPod", "Connection", "API Key"],
    },
  ],

  // Commands for the topbar menu
  commands: [
    {
      id: COMMAND_ID,
      label: "Run on Cloud",
      function: runOnCloud,
    },
  ],

  // Place the command in the top menu bar
  menuCommands: [
    {
      path: ["RunPod"],
      commands: [COMMAND_ID],
    },
  ],

  init() {
    injectStyles();
  },

  async setup() {
    let injected = false;

    // Try ComfyButton API (works in standard ComfyUI with legacy menu)
    try {
      const { ComfyButton } = await import("../../scripts/ui/components/button.js");
      const { ComfyButtonGroup } = await import("../../scripts/ui/components/buttonGroup.js");

      const btn = new ComfyButton({
        icon: "cloud-upload",
        action: runOnCloud,
        tooltip: "Run on Cloud (RunPod)",
        content: "Run on Cloud",
        classList: "comfyui-button comfyui-menu-mobile-collapse",
      });

      const group = new ComfyButtonGroup(btn.element);
      if (app.menu?.settingsGroup?.element) {
        app.menu.settingsGroup.element.before(group.element);
        injected = true;
      }
    } catch {
      // ComfyButton not available
    }

    // Fallback: inject a plain button into whatever menu container exists
    if (!injected) {
      const btn = document.createElement("button");
      btn.id = "runpod-cloud-btn";
      btn.textContent = "Run on Cloud";
      btn.title = "Submit workflow to RunPod serverless endpoint";
      btn.addEventListener("click", runOnCloud);

      // Try legacy .comfy-menu first
      const legacyMenu = document.querySelector(".comfy-menu");
      if (legacyMenu) {
        legacyMenu.append(btn);
        injected = true;
      }

      // If nothing matched yet, use MutationObserver to wait for DOM
      if (!injected) {
        const observer = new MutationObserver(() => {
          const menu = document.querySelector(".comfy-menu");
          if (menu) {
            menu.append(btn);
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10000);
      }
    }
  },
});
