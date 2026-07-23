import "./style.css";
import JSZip from "jszip";
import { inject } from "@vercel/analytics";
import type { OperationInfo } from "./openapi";
import { parseSpec, listOperations, isOpenApiSpec, getSpecVersion } from "./openapi";
import { generateStarterSuite } from "./starter-suite";
import { buildSuiteFiles } from "./zip-suite";
import { computeSpecSignature, isSuiteAlreadyDownloaded } from "./suite-download-state";
import { SAMPLE_SPEC } from "./sample-spec";
import { highlightSpec, highlightTs, escapeHtml } from "./highlight";

inject();

// ── Activity tracking ─────────────────────────────────────────────────────────

type TrackEvent =
  | "visit"
  | "generated"
  | "copied"
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

function logSuiteDownload(endpointCount: number, specVersion: string | undefined) {
  fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "suite_downloaded", endpointCount, specVersion }),
  }).catch(() => {});
}

logActivity("visit");

// ── HTML ──────────────────────────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main class="wrap">
    <h1>OpenAPI → Playwright</h1>
    <p class="tagline">Generate ready-to-run API tests from your OpenAPI specification.</p>

    <div class="card">
      <label class="upload">
        <input type="file" id="file-input" accept=".yaml,.yml,.json" />
        <span id="upload-label">Upload openapi.yaml / .json</span>
      </label>
      <div class="or or--url">or fetch from URL</div>
      <div class="url-row">
        <input type="url" id="url-input" placeholder="https://api.example.com/openapi.yaml" />
        <button id="url-btn" type="button">Fetch</button>
      </div>
      <div class="or or--paste">or paste it below</div>
      <div class="editor-wrap">
        <pre id="spec-highlight" class="editor-highlight" aria-hidden="true"></pre>
        <textarea id="spec-input" class="editor-input" spellcheck="false" placeholder="Paste your OpenAPI/Swagger spec here (YAML or JSON)..."></textarea>
      </div>
    </div>

    <div class="card" id="endpoint-card" hidden>
      <label for="endpoint-select">Endpoint</label>
      <select id="endpoint-select"></select>
    </div>

    <div class="card suite-card" id="suite-card" hidden>
      <div class="suite-row">
        <span id="suite-count-label" class="suite-count-label"></span>
        <button id="suite-download-btn" type="button" class="suite-download-btn"></button>
      </div>
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
const specHighlight = document.querySelector<HTMLPreElement>("#spec-highlight")!;
const urlInput = document.querySelector<HTMLInputElement>("#url-input")!;
const urlBtn = document.querySelector<HTMLButtonElement>("#url-btn")!;
const endpointCard = document.querySelector<HTMLDivElement>("#endpoint-card")!;
const endpointSelect = document.querySelector<HTMLSelectElement>("#endpoint-select")!;
const suiteCard = document.querySelector<HTMLDivElement>("#suite-card")!;
const suiteCountLabel = document.querySelector<HTMLSpanElement>("#suite-count-label")!;
const suiteDownloadBtn = document.querySelector<HTMLButtonElement>("#suite-download-btn")!;
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
// Signature of the spec at the moment of the last successful suite download — null
// means nothing has been downloaded yet this session. Compared against the current
// spec each time a new one loads, to decide whether "Download full suite" re-enables.
let lastDownloadedSpecSignature: string | null = null;

// ── Error / clear ─────────────────────────────────────────────────────────────

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  endpointCard.hidden = true;
  suiteCard.hidden = true;
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

// ── Spec editor highlighting ──────────────────────────────────────────────────
// The textarea stays fully editable and native; a highlighted <pre> sits behind it
// (transparent textarea text, visible caret) and is kept in sync on every keystroke.

function refreshSpecHighlight() {
  specHighlight.innerHTML = highlightSpec(specInput.value);
}

function setSpecValue(text: string) {
  specInput.value = text;
  refreshSpecHighlight();
  specHighlight.scrollTop = 0;
  specHighlight.scrollLeft = 0;
}

specInput.addEventListener("input", refreshSpecHighlight);
specInput.addEventListener("scroll", () => {
  specHighlight.scrollTop = specInput.scrollTop;
  specHighlight.scrollLeft = specInput.scrollLeft;
});

// ── Spec loading ──────────────────────────────────────────────────────────────

function loadSpecText(text: string, track = true) {
  try {
    const parsed = parseSpec(text);
    if (!isOpenApiSpec(parsed)) {
      showError("This doesn't look like an OpenAPI/Swagger spec — missing the 'openapi' or 'swagger' version field.");
      return;
    }
    spec = parsed;
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
  // op.path comes straight from the parsed spec — untrusted (pasted or fetched from a
  // user-supplied URL), so it must be escaped before going into innerHTML.
  endpointSelect.innerHTML = operations
    .map((op, i) => `<option value="${i}">${escapeHtml(op.method.toUpperCase())} ${escapeHtml(op.path)}</option>`)
    .join("");
  endpointCard.hidden = false;

  suiteCountLabel.textContent = `${operations.length} endpoint${operations.length === 1 ? "" : "s"} detected`;
  if (isSuiteAlreadyDownloaded(spec, lastDownloadedSpecSignature)) {
    suiteDownloadBtn.textContent = "✓ Suite downloaded";
    suiteDownloadBtn.disabled = true;
  } else {
    suiteDownloadBtn.textContent = `Download full suite (${operations.length})`;
    suiteDownloadBtn.disabled = false;
  }
  suiteCard.hidden = false;

  renderOutput(0, track);
}

function renderOutput(index: number, track = true) {
  const op = operations[index];
  try {
    const code = generateStarterSuite(spec, op);
    outputCode.innerHTML = highlightTs(code);
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

// ── URL fetch (shared by the manual Fetch button and the real-API quick-start buttons) ─

async function fetchAndLoadSpec(url: string, outputLabelText: string): Promise<string> {
  const res = await fetch(`/api/fetch-spec?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  setSpecValue(text);
  outputLabel.textContent = outputLabelText;
  loadSpecText(text);
  return text;
}

urlBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  urlBtn.disabled = true;
  urlBtn.textContent = "Fetching…";
  try {
    await fetchAndLoadSpec(url, "Generated test");
    logActivity("fetched_url");
  } catch (e: any) {
    showError(`Couldn't fetch spec from URL: ${e.message ?? e}`);
  } finally {
    urlBtn.disabled = false;
    urlBtn.textContent = "Fetch";
  }
});

// ── Endpoint select ───────────────────────────────────────────────────────────

endpointSelect.addEventListener("change", () => {
  renderOutput(Number(endpointSelect.value));
});

// ── Full-suite ZIP download ───────────────────────────────────────────────────

suiteDownloadBtn.addEventListener("click", async () => {
  if (operations.length === 0) return;
  // Disabling synchronously (before the await) is what blocks a second click from
  // starting a second zip while this one is still generating.
  suiteDownloadBtn.disabled = true;
  suiteDownloadBtn.textContent = "Zipping…";
  try {
    const files = buildSuiteFiles(spec, operations);
    const zip = new JSZip();
    for (const file of files) zip.file(file.path, file.content);
    const blob = await zip.generateAsync({ type: "blob" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "playwright-api-tests.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    logSuiteDownload(operations.length, getSpecVersion(spec));

    // Stays disabled: re-enables only once populateEndpoints sees a spec whose
    // signature no longer matches this one (a genuinely new/changed spec).
    lastDownloadedSpecSignature = computeSpecSignature(spec);
    suiteDownloadBtn.textContent = "✓ Suite downloaded";
  } catch (e: any) {
    suiteDownloadBtn.disabled = false;
    suiteDownloadBtn.textContent = `Download full suite (${operations.length})`;
    showError(`Couldn't build the zip: ${e.message ?? e}`);
  }
});

// ── Copy ──────────────────────────────────────────────────────────────────────

copyBtn.addEventListener("click", async () => {
  // Track and show feedback immediately — before the clipboard write so mobile
  // browsers that throw on clipboard.writeText still register the copy intent.
  logActivity("copied", "button");
  const original = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  window.setTimeout(() => (copyBtn.textContent = original), 1200);
  try {
    await navigator.clipboard.writeText(outputCode.textContent ?? "");
  } catch {
    // Clipboard API unavailable or permission denied — button feedback already shown above.
  }
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

setSpecValue(SAMPLE_SPEC);
outputLabel.textContent = "Generated test · sample spec";
loadSpecText(SAMPLE_SPEC, false);
