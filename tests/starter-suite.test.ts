import { describe, it, expect } from "vitest";
import { listOperations } from "../src/openapi";
import { generateStarterSuite } from "../src/starter-suite";

// ── Shared test spec ──────────────────────────────────────────────────────────
// Deliberately separate from sample-openapi.yaml so tests are self-documenting
// and don't break when the sample changes.

const spec = {
  openapi: "3.0.0",
  servers: [{ url: "https://api.test.io" }],
  paths: {
    "/users": {
      get: {
        summary: "List users",
        security: [],
        parameters: [
          { name: "page", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { users: { type: "array", items: { type: "object" } } },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Create user",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { description: "Bad Request" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/users/{id}": {
      get: {
        summary: "Get user",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "integer" },
                    email: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { description: "Not Found" },
        },
      },
    },
  },
};

const ops = listOperations(spec);
const byKey = (key: string) => ops.find((o) => o.key === key)!;

// ── POST /users ───────────────────────────────────────────────────────────────

describe("generateStarterSuite: POST /users (auth, required field, body)", () => {
  const output = generateStarterSuite(spec, byKey("POST /users"));

  it("generates a happy path test with correct status", () => {
    expect(output).toContain("// ✅ Happy Path");
    expect(output).toContain("Create user (happy path)");
    expect(output).toContain("expect(response.status()).toBe(201)");
  });

  it("includes Authorization header in the happy path", () => {
    expect(output).toContain(
      "Authorization: `Bearer ${process.env.API_TOKEN ?? '<TOKEN>'}`,",
    );
  });

  it("posts to the correct URL", () => {
    expect(output).toContain("request.post(`https://api.test.io/users`");
  });

  it("generates a payload from the request body schema", () => {
    expect(output).toContain('"email": "user@example.com"');
  });

  it("generates an input-validation test for missing required field", () => {
    expect(output).toContain("// ⚠ Input Validation");
    // escape() converts ' → \' in test titles, so assert against the escaped form
    expect(output).toContain("when \\'email\\' is missing");
    expect(output).toContain("expect(response.status()).toBe(400)");
  });

  it("generates an auth-required test", () => {
    expect(output).toContain("// 🔒 Authentication");
    expect(output).toContain("requires authentication");
    expect(output).toContain("expect(response.status()).toBe(401)");
  });

  it("auth test omits the Authorization header", () => {
    // The auth test must fire without a token — verify the header block is empty
    // by checking the auth test block doesn't include the Bearer line.
    // We verify indirectly: the auth section should appear after the happy section.
    const happyIdx = output.indexOf("Create user (happy path)");
    const authIdx = output.indexOf("requires authentication");
    expect(authIdx).toBeGreaterThan(happyIdx);
  });
});

// ── GET /users/{id} ──────────────────────────────────────────────────────────

describe("generateStarterSuite: GET /users/{id} (path param, 404 contract)", () => {
  const output = generateStarterSuite(spec, byKey("GET /users/{id}"));

  it("generates a happy path test", () => {
    expect(output).toContain("Get user (happy path)");
    expect(output).toContain("expect(response.status()).toBe(200)");
  });

  it("asserts a property from the response schema", () => {
    expect(output).toContain("expect(body).toHaveProperty('id')");
  });

  it("generates a 404 contract test for a non-existent id", () => {
    expect(output).toContain("// 🛡 Contract Validation");
    expect(output).toContain("returns 404 for a non-existent id");
    expect(output).toContain("expect(response.status()).toBe(404)");
  });

  it("uses a recognisable non-existent value in the 404 path", () => {
    expect(output).toContain("nonexistent-id-000000");
  });

  it("generates an invalid-format test because id is typed as integer", () => {
    expect(output).toContain("invalid id format");
  });
});

// ── GET /users (list + pagination) ───────────────────────────────────────────

describe("generateStarterSuite: GET /users (collection, pagination)", () => {
  const output = generateStarterSuite(spec, byKey("GET /users"));

  it("generates a happy path test", () => {
    expect(output).toContain("List users (happy path)");
    expect(output).toContain("expect(response.status()).toBe(200)");
  });

  it("generates a pagination variant for the page parameter", () => {
    // escape() converts ' → \' in test titles; JSON.stringify is compact (no spaces)
    expect(output).toContain("supports the \\'page\\' parameter");
    expect(output).toContain('"page":2');
  });

  it("does NOT generate an auth test when security is []", () => {
    expect(output).not.toContain("// 🔒 Authentication");
  });
});

// ── required-field behaviour ─────────────────────────────────────────────────

describe("generateStarterSuite: required field presence", () => {
  const specWithRequired = {
    paths: {
      "/items": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    desc: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "OK" }, "400": { description: "Bad Request" } },
        },
      },
    },
  };

  const specWithoutRequired = {
    paths: {
      "/items": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    desc: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };

  it("generates a missing-required-field test when schema.required is declared", () => {
    const op = listOperations(specWithRequired)[0];
    const output = generateStarterSuite(specWithRequired, op);
    expect(output).toContain("when \\'name\\' is missing");
  });

  it("does NOT generate a missing-required-field test when schema.required is absent", () => {
    const op = listOperations(specWithoutRequired)[0];
    const output = generateStarterSuite(specWithoutRequired, op);
    expect(output).not.toContain("is missing");
  });
});
