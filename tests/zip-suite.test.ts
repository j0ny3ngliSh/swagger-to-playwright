import { describe, it, expect } from "vitest";
import { listOperations } from "../src/openapi";
import type { OperationInfo } from "../src/openapi";
import { buildSuiteFiles, filenameForOperation, folderForOperation } from "../src/zip-suite";

const taggedSpec = {
  openapi: "3.0.0",
  servers: [{ url: "https://api.test.io" }],
  paths: {
    "/pets": {
      get: { tags: ["Pets"], summary: "List pets", responses: { "200": { description: "OK" } } },
      post: {
        tags: ["Pets"],
        summary: "Create pet",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/pets/{petId}": {
      get: {
        tags: ["Pets"],
        summary: "Get pet",
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
    },
    "/orders": {
      get: { tags: ["Orders"], summary: "List orders", responses: { "200": { description: "OK" } } },
    },
    "/health": {
      get: { summary: "Health check", responses: { "200": { description: "OK" } } },
    },
  },
};

describe("filenameForOperation", () => {
  it("joins method and sanitized path segments", () => {
    const op: OperationInfo = { key: "GET /pets", method: "get", path: "/pets", parameters: [] };
    expect(filenameForOperation(op)).toBe("get-pets.spec.ts");
  });

  it("strips braces from path params instead of dropping them", () => {
    const op: OperationInfo = { key: "GET /pets/{petId}", method: "get", path: "/pets/{petId}", parameters: [] };
    expect(filenameForOperation(op)).toBe("get-pets-petid.spec.ts");
  });

  it("falls back to just the method for the root path", () => {
    const op: OperationInfo = { key: "GET /", method: "get", path: "/", parameters: [] };
    expect(filenameForOperation(op)).toBe("get.spec.ts");
  });

  it("sanitizes characters that aren't filesystem-safe", () => {
    const op: OperationInfo = {
      key: "GET /foo_bar.baz",
      method: "get",
      path: "/foo_bar.baz",
      parameters: [],
    };
    expect(filenameForOperation(op)).toBe("get-foo-bar-baz.spec.ts");
  });
});

describe("folderForOperation", () => {
  it("uses the operation's first tag when present", () => {
    const op: OperationInfo = { key: "GET /pets", method: "get", path: "/pets", tags: ["Pets"], parameters: [] };
    expect(folderForOperation(op)).toBe("pets");
  });

  it("falls back to the first path segment when there's no tag", () => {
    const op: OperationInfo = { key: "GET /orders/1", method: "get", path: "/orders/1", parameters: [] };
    expect(folderForOperation(op)).toBe("orders");
  });

  it("falls back to 'untagged' for the root path with no tag", () => {
    const op: OperationInfo = { key: "GET /", method: "get", path: "/", parameters: [] };
    expect(folderForOperation(op)).toBe("untagged");
  });

  it("ignores empty-string tags", () => {
    const op: OperationInfo = { key: "GET /orders", method: "get", path: "/orders", tags: [""], parameters: [] };
    expect(folderForOperation(op)).toBe("orders");
  });
});

describe("buildSuiteFiles", () => {
  it("returns an empty array for a spec with no operations", () => {
    expect(buildSuiteFiles({}, [])).toEqual([]);
  });

  it("generates exactly one spec file per endpoint, plus a README", () => {
    const operations = listOperations(taggedSpec);
    const files = buildSuiteFiles(taggedSpec, operations);
    const specFiles = files.filter((f) => f.path !== "README.md");
    expect(specFiles).toHaveLength(operations.length);
    expect(files.find((f) => f.path === "README.md")).toBeDefined();
  });

  it("groups files into folders by tag, and untagged ops by their first path segment", () => {
    const operations = listOperations(taggedSpec);
    const files = buildSuiteFiles(taggedSpec, operations);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("tests/pets/get-pets.spec.ts");
    expect(paths).toContain("tests/pets/post-pets.spec.ts");
    expect(paths).toContain("tests/pets/get-pets-petid.spec.ts");
    expect(paths).toContain("tests/orders/get-orders.spec.ts");
    expect(paths).toContain("tests/health/get-health.spec.ts");
  });

  it("every generated file has non-empty Playwright test content", () => {
    const operations = listOperations(taggedSpec);
    const files = buildSuiteFiles(taggedSpec, operations);
    for (const f of files.filter((f) => f.path !== "README.md")) {
      expect(f.content).toContain("import { test, expect } from '@playwright/test';");
      expect(f.content).toContain("test.describe(");
    }
  });

  it("calls the provided generate function once per operation, not codegen re-implemented locally", () => {
    const operations = listOperations(taggedSpec);
    const seen: OperationInfo[] = [];
    const stubGenerate = (_spec: any, op: OperationInfo) => {
      seen.push(op);
      return `// stub for ${op.key}`;
    };
    const files = buildSuiteFiles(taggedSpec, operations, stubGenerate);
    expect(seen).toHaveLength(operations.length);
    expect(seen.map((o) => o.key).sort()).toEqual(operations.map((o) => o.key).sort());
    expect(files.find((f) => f.path === "tests/pets/get-pets.spec.ts")?.content).toBe("// stub for GET /pets");
  });

  it("de-duplicates filenames that collide within the same folder by appending -2", () => {
    const operations: OperationInfo[] = [
      { key: "GET /foo_bar", method: "get", path: "/foo_bar", parameters: [] },
      { key: "GET /foo-bar", method: "get", path: "/foo-bar", parameters: [] },
    ];
    const files = buildSuiteFiles({}, operations, () => "// content");
    const specPaths = files.filter((f) => f.path !== "README.md").map((f) => f.path).sort();
    expect(specPaths).toEqual(["tests/foo-bar/get-foo-bar-2.spec.ts", "tests/foo-bar/get-foo-bar.spec.ts"]);
  });

  it("includes the endpoint count in the README", () => {
    const operations = listOperations(taggedSpec);
    const files = buildSuiteFiles(taggedSpec, operations);
    const readme = files.find((f) => f.path === "README.md")!;
    expect(readme.content).toContain(`${operations.length} endpoints`);
  });
});
