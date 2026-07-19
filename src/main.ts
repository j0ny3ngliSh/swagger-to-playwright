import "./style.css";
import { inject } from "@vercel/analytics";
import type { OperationInfo } from "./openapi";
import { parseSpec, listOperations } from "./openapi";
import { generateStarterSuite } from "./starter-suite";
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
    <p class="tagline">Generate ready-to-run API tests from your OpenAPI specification.</p>
    <p class="subtitle">Upload your Swagger/OpenAPI file, select an endpoint, and get Playwright tests generated from your API contract.</p>

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

    <div class="card email-card">
      <p class="email-tagline">Get updates when new Playwright API testing features are released.</p>
      <div class="email-row">
        <input type="email" id="email-input" placeholder="your@email.com" />
        <button id="email-btn" type="button">Get updates</button>
      </div>
      <div id="email-feedback" class="email-feedback" hidden></div>
    </div>
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
    const code = generateStarterSuite(spec, op);
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

// ── Email capture ────────────────────────────────────────────────────────────

const emailInput = document.querySelector<HTMLInputElement>("#email-input")!;
const emailBtn = document.querySelector<HTMLButtonElement>("#email-btn")!;
const emailFeedback = document.querySelector<HTMLDivElement>("#email-feedback")!;

function showEmailFeedback(message: string, type: "success" | "error") {
  emailFeedback.textContent = message;
  emailFeedback.className = `email-feedback email-feedback--${type}`;
  emailFeedback.hidden = false;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

emailBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!EMAIL_REGEX.test(email)) {
    showEmailFeedback("Please enter a valid email address.", "error");
    return;
  }

  emailBtn.disabled = true;
  emailBtn.textContent = "Subscribing…";

  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok || res.status === 204) {
      showEmailFeedback("You're in — we'll email you when new features ship.", "success");
      emailInput.value = "";
    } else {
      showEmailFeedback("Something went wrong. Please try again.", "error");
    }
  } catch {
    // Non-blocking: if the API is unavailable the main tool still works fine.
    showEmailFeedback("Could not connect. Your subscription wasn't saved.", "error");
  } finally {
    emailBtn.disabled = false;
    emailBtn.textContent = "Get updates";
  }
});
