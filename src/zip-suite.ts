import type { OperationInfo } from "./openapi";
import { generateStarterSuite } from "./starter-suite";

export interface SuiteFile {
  /** Path inside the zip, e.g. "tests/pets/get-pets-petid.spec.ts" or "README.md". */
  path: string;
  content: string;
}

// Turns an arbitrary spec string (tag name, path segment, operationId) into a
// lowercase, filesystem/zip-safe token. Path params like "{petId}" lose their
// braces rather than being dropped, so "/pets/{petId}" stays disambiguated from
// "/pets".
function sanitizeSegment(raw: string): string {
  const cleaned = raw
    .replace(/[{}]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "root";
}

// Groups by the operation's first OpenAPI tag when present (the spec author's own
// notion of "resource"); falls back to the first path segment so untagged specs
// still get sensible folders instead of dumping every file at the top level.
export function folderForOperation(op: OperationInfo): string {
  const tag = op.tags?.find((t) => t && t.trim().length > 0);
  if (tag) return sanitizeSegment(tag);

  const firstSegment = op.path.split("/").find((s) => s.length > 0);
  return firstSegment ? sanitizeSegment(firstSegment) : "untagged";
}

export function filenameForOperation(op: OperationInfo): string {
  const pathPart = op.path
    .split("/")
    .filter((s) => s.length > 0)
    .map(sanitizeSegment)
    .join("-");
  const base = pathPart ? `${op.method}-${pathPart}` : op.method;
  return `${base}.spec.ts`;
}

// Appends -2, -3, ... on collision within the same folder. Collisions are rare
// (distinct method+path pairs sanitize differently in practice) but two paths that
// only differ in characters stripped by sanitizeSegment, e.g. "/foo_bar" vs
// "/foo-bar", would otherwise overwrite each other silently inside the zip.
function uniqueFilename(folder: string, base: string, usedByFolder: Map<string, Set<string>>): string {
  let used = usedByFolder.get(folder);
  if (!used) {
    used = new Set();
    usedByFolder.set(folder, used);
  }
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".spec.ts");
  const stem = dot === -1 ? base : base.slice(0, dot);
  let n = 2;
  let candidate = `${stem}-${n}.spec.ts`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}.spec.ts`;
  }
  used.add(candidate);
  return candidate;
}

function buildReadme(operations: OperationInfo[]): string {
  const lines = [
    "# Playwright API Test Suite",
    "",
    `Generated from your OpenAPI spec — ${operations.length} endpoint${operations.length === 1 ? "" : "s"}, one file each, grouped by tag under \`tests/\`.`,
    "",
    "Each file covers happy path, contract validation, input validation, and authentication checks where the spec documents them.",
    "",
    "## Run",
    "",
    "```",
    "npm install -D @playwright/test",
    "npx playwright test",
    "```",
    "",
    "## Auth",
    "",
    "Authenticated endpoints read `process.env.API_TOKEN`:",
    "",
    "```",
    "API_TOKEN=your-token npx playwright test",
    "```",
    "",
  ];
  return lines.join("\n");
}

// Generates the full multi-file suite: one spec file per endpoint (via the same
// generateStarterSuite used for the single-endpoint Copy button — no codegen logic
// duplicated here) plus a top-level README. Pure and DOM-free so it's unit
// testable without mocking JSZip or the browser.
export function buildSuiteFiles(
  spec: any,
  operations: OperationInfo[],
  generate: (spec: any, op: OperationInfo) => string = generateStarterSuite,
): SuiteFile[] {
  if (operations.length === 0) return [];

  const usedByFolder = new Map<string, Set<string>>();
  const files: SuiteFile[] = operations.map((op) => {
    const folder = folderForOperation(op);
    const name = uniqueFilename(folder, filenameForOperation(op), usedByFolder);
    return { path: `tests/${folder}/${name}`, content: generate(spec, op) };
  });

  files.push({ path: "README.md", content: buildReadme(operations) });
  return files;
}
