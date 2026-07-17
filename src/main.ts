import "./style.css";
import { inject } from "@vercel/analytics";
import type { OperationInfo } from "./openapi";
import { parseSpec, listOperations } from "./openapi";
import { generateTest } from "./codegen";
import { SAMPLE_SPEC } from "./sample-spec";

inject();

function logActivity(
  event: "visit" | "generated" | "copied" | "tried_sample",
  method?: "button" | "selection",
) {
  fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, method }),
  }).catch(() => {});
}

logActivity("visit");

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="wrap">
    <h1>OpenAPI → Playwright</h1>
    <p class="subtitle">Upload a spec, pick an endpoint, get a ready-to-run Playwright test.</p>

    <div class="card">
      <label class="upload">
        <input type="file" id="file-input" accept=".yaml,.yml,.json" />
        <span id="upload-label">Upload openapi.yaml / .json</span>
      </label>
      <div class="or">or paste it below</div>
      <textarea id="spec-input" placeholder="Paste your OpenAPI/Swagger spec here (YAML or JSON)..."></textarea>
      <button id="sample-btn" type="button" class="sample-btn">Try with sample spec</button>
    </div>

    <div class="card" id="endpoint-card" hidden>
      <label for="endpoint-select">Endpoint</label>
      <select id="endpoint-select"></select>
    </div>

    <div class="card" id="output-card" hidden>
      <div class="output-header">
        <span>Generated test</span>
        <button id="copy-btn">Copy</button>
      </div>
      <pre id="output-code"></pre>
    </div>

    <div id="error" class="error" hidden></div>
  </main>
`;

const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const uploadLabel = document.querySelector<HTMLSpanElement>("#upload-label")!;
const specInput = document.querySelector<HTMLTextAreaElement>("#spec-input")!;
const sampleBtn = document.querySelector<HTMLButtonElement>("#sample-btn")!;
const endpointCard = document.querySelector<HTMLDivElement>("#endpoint-card")!;
const endpointSelect = document.querySelector<HTMLSelectElement>("#endpoint-select")!;
const outputCard = document.querySelector<HTMLDivElement>("#output-card")!;
const outputCode = document.querySelector<HTMLPreElement>("#output-code")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copy-btn")!;
const errorBox = document.querySelector<HTMLDivElement>("#error")!;

let spec: any = null;
let operations: OperationInfo[] = [];

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  endpointCard.hidden = true;
  outputCard.hidden = true;
}

function clearError() {
  errorBox.hidden = true;
}

function loadSpecText(text: string) {
  try {
    spec = parseSpec(text);
    operations = listOperations(spec);
    if (operations.length === 0) {
      showError("No operations found in this spec (no paths/methods detected).");
      return;
    }
    clearError();
    populateEndpoints();
  } catch (e: any) {
    showError(`Couldn't parse spec: ${e.message ?? e}`);
  }
}

function populateEndpoints() {
  endpointSelect.innerHTML = operations
    .map((op, i) => `<option value="${i}">${op.method.toUpperCase()} ${op.path}</option>`)
    .join("");
  endpointCard.hidden = false;
  renderOutput(0);
}

function renderOutput(index: number) {
  const op = operations[index];
  try {
    const code = generateTest(spec, op);
    outputCode.textContent = code;
    outputCard.hidden = false;
    logActivity("generated");
  } catch (e: any) {
    showError(`Couldn't generate test: ${e.message ?? e}`);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  uploadLabel.textContent = file.name;
  file.text().then(loadSpecText);
});

let debounceTimer: number | undefined;
specInput.addEventListener("input", () => {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    if (specInput.value.trim().length > 0) {
      loadSpecText(specInput.value);
    }
  }, 400);
});

sampleBtn.addEventListener("click", () => {
  specInput.value = SAMPLE_SPEC;
  loadSpecText(SAMPLE_SPEC);
  logActivity("tried_sample");
});

endpointSelect.addEventListener("change", () => {
  renderOutput(Number(endpointSelect.value));
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(outputCode.textContent ?? "");
  logActivity("copied", "button");
  const original = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  window.setTimeout(() => (copyBtn.textContent = original), 1200);
});

// Catches manual select-all + Cmd/Ctrl-C, which doesn't go through the Copy button.
outputCode.addEventListener("copy", () => {
  logActivity("copied", "selection");
});
