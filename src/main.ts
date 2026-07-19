import "./style.css";
import { inject } from "@vercel/analytics";
import type { OperationInfo } from "./openapi";
import { parseSpec, listOperations } from "./openapi";
import { generateStarterSuite } from "./starter-suite";
import { SAMPLE_SPEC } from "./sample-spec";

inject();

// ── Activity tracking ─────────────────────────────────────────────────────────

type TrackEvent =
  | "visit"
  | "generated"
  | "copied"
  | "tried_sample"
  | "thumbs_up"
  | "thumbs_down"
  | "fetched_url";

function logActivity(event: TrackEvent, method?: "button" | "selection") {
  fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, method }),
  }).catch(() => {});
}

logActivity("visit");

// ── HTML ──────────────────────────────────────────────────────────────────────

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
      <div class="or">or fetch from URL</div>
      <div class="url-row">
        <input type="url" id="url-input" placeholder="https://api.example.com/openapi.yaml" />
        <button id="url-btn" type="button">Fetch</button>
      </div>
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
        <span id="output-label">Generated test</span>
        <button id="copy-btn">Copy</button>
      </div>
      <pre id="output-code"></pre>
    </div>

    <div class="card feedback-card" id="feedback-card" hidden>
      <div class="feedback-row">
        <span class="feedback-label">Was this useful?</span>
        <button id="thumb-up" type="button" class="thumb-btn">👍</button>
        <button id="thumb-down" type="button" class="thumb-btn">👎</button>
      </div>
      <div id="feedback-missing-row" hidden>
        <div class="feedback-missing-inner">
          <input type="text" id="feedback-missing" placeholder="What was missing?" maxlength="500" />
          <button id="feedback-send" type="button" class="feedback-send-btn">Send</button>
        </div>
      </div>
      <p id="feedback-thanks" hidden>Thanks — this helps a lot.</p>
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

// ── Element refs ──────────────────────────────────────────────────────────────

const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const uploadLabel = document.querySelector<HTMLSpanElement>("#upload-label")!;
const specInput = document.querySelector<HTMLTextAreaElement>("#spec-input")!;
const sampleBtn = document.querySelector<HTMLButtonElement>("#sample-btn")!;
const urlInput = document.querySelector<HTMLInputElement>("#url-input")!;
const urlBtn = document.querySelector<HTMLButtonElement>("#url-btn")!;
const endpointCard = document.querySelector<HTMLDivElement>("#endpoint-card")!;
const endpointSelect = document.querySelector<HTMLSelectElement>("#endpoint-select")!;
const outputCard = document.querySelector<HTMLDivElement>("#output-card")!;
const outputLabel = document.querySelector<HTMLSpanElement>("#output-label")!;
const outputCode = document.querySelector<HTMLPreElement>("#output-code")!;
const copyBtn = document.querySelector<HTMLButtonElement>("#copy-btn")!;
const errorBox = document.querySelector<HTMLDivElement>("#error")!;

const feedbackCard = document.querySelector<HTMLDivElement>("#feedback-card")!;
const thumbUp = document.querySelector<HTMLButtonElement>("#thumb-up")!;
const thumbDown = document.querySelector<HTMLButtonElement>("#thumb-down")!;
const feedbackMissingRow = document.querySelector<HTMLDivElement>("#feedback-missing-row")!;
const feedbackMissing = document.querySelector<HTMLInputElement>("#feedback-missing")!;
const feedbackSend = document.querySelector<HTMLButtonElement>("#feedback-send")!;
const feedbackThanks = document.querySelector<HTMLParagraphElement>("#feedback-thanks")!;

const emailInput = document.querySelector<HTMLInputElement>("#email-input")!;
const emailBtn = document.querySelector<HTMLButtonElement>("#email-btn")!;
const emailFeedback = document.querySelector<HTMLDivElement>("#email-feedback")!;

// ── State ─────────────────────────────────────────────────────────────────────

let spec: any = null;
let operations: OperationInfo[] = [];

// ── Error / clear ─────────────────────────────────────────────────────────────

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  endpointCard.hidden = true;
  outputCard.hidden = true;
  feedbackCard.hidden = true;
}

function clearError() {
  errorBox.hidden = true;
}

// ── Feedback widget ───────────────────────────────────────────────────────────

function resetFeedback() {
  thumbUp.disabled = false;
  thumbDown.disabled = false;
  feedbackMissingRow.hidden = true;
  feedbackMissing.value = "";
  feedbackThanks.hidden = true;
  feedbackCard.hidden = false;
}

thumbUp.addEventListener("click", () => {
  logActivity("thumbs_up");
  thumbUp.disabled = true;
  thumbDown.disabled = true;
  feedbackThanks.hidden = false;
});

thumbDown.addEventListener("click", () => {
  logActivity("thumbs_down");
  thumbDown.disabled = true;
  thumbUp.disabled = true;
  feedbackMissingRow.hidden = false;
  feedbackMissing.focus();
});

feedbackSend.addEventListener("click", async () => {
  const text = feedbackMissing.value.trim();
  if (!text) return;
  feedbackSend.disabled = true;
  try {
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Non-blocking — a failed send shouldn't disrupt the user
  } finally {
    feedbackSend.disabled = false;
    feedbackMissingRow.hidden = true;
    feedbackThanks.hidden = false;
  }
});

// ── Spec loading ──────────────────────────────────────────────────────────────

function loadSpecText(text: string, track = true) {
  try {
    spec = parseSpec(text);
    operations = listOperations(spec);
    if (operations.length === 0) {
      showError("No operations found in this spec (no paths/methods detected).");
      return;
    }
    clearError();
    populateEndpoints(track);
  } catch (e: any) {
    showError(`Couldn't parse spec: ${e.message ?? e}`);
  }
}

function populateEndpoints(track = true) {
  endpointSelect.innerHTML = operations
    .map((op, i) => `<option value="${i}">${op.method.toUpperCase()} ${op.path}</option>`)
    .join("");
  endpointCard.hidden = false;
  renderOutput(0, track);
}

function renderOutput(index: number, track = true) {
  const op = operations[index];
  try {
    const code = generateStarterSuite(spec, op);
    outputCode.textContent = code;
    outputCard.hidden = false;
    resetFeedback();
    if (track) logActivity("generated");
  } catch (e: any) {
    showError(`Couldn't generate test: ${e.message ?? e}`);
  }
}

// ── File upload ───────────────────────────────────────────────────────────────

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  uploadLabel.textContent = file.name;
  outputLabel.textContent = "Generated test";
  file.text().then((text) => loadSpecText(text));
});

// ── Textarea (paste / type) ───────────────────────────────────────────────────

let debounceTimer: number | undefined;
specInput.addEventListener("input", () => {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    if (specInput.value.trim().length > 0) {
      outputLabel.textContent = "Generated test";
      loadSpecText(specInput.value);
    }
  }, 400);
});

// ── URL fetch ─────────────────────────────────────────────────────────────────

urlBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  urlBtn.disabled = true;
  urlBtn.textContent = "Fetching…";
  try {
    const res = await fetch(`/api/fetch-spec?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    specInput.value = text;
    outputLabel.textContent = "Generated test";
    loadSpecText(text);
    logActivity("fetched_url");
  } catch (e: any) {
    showError(`Couldn't fetch spec from URL: ${e.message ?? e}`);
  } finally {
    urlBtn.disabled = false;
    urlBtn.textContent = "Fetch";
  }
});

// ── Sample spec ───────────────────────────────────────────────────────────────

sampleBtn.addEventListener("click", () => {
  specInput.value = SAMPLE_SPEC;
  outputLabel.textContent = "Generated test · sample spec";
  loadSpecText(SAMPLE_SPEC);
  logActivity("tried_sample");
});

// ── Endpoint select ───────────────────────────────────────────────────────────

endpointSelect.addEventListener("change", () => {
  renderOutput(Number(endpointSelect.value));
});

// ── Copy ──────────────────────────────────────────────────────────────────────

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(outputCode.textContent ?? "");
  logActivity("copied", "button");
  const original = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  window.setTimeout(() => (copyBtn.textContent = original), 1200);
});

outputCode.addEventListener("copy", () => {
  logActivity("copied", "selection");
});

// ── Email capture ─────────────────────────────────────────────────────────────

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
    showEmailFeedback("Could not connect. Your subscription wasn't saved.", "error");
  } finally {
    emailBtn.disabled = false;
    emailBtn.textContent = "Get updates";
  }
});

// ── Auto-load sample on start ─────────────────────────────────────────────────
// Populate output immediately so visitors see a real test without any action.
// track=false so page loads don't inflate the "generated" funnel metric.

specInput.value = SAMPLE_SPEC;
outputLabel.textContent = "Generated test · sample spec";
loadSpecText(SAMPLE_SPEC, false);
