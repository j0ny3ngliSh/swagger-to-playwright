import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpec, listOperations } from "../src/openapi";
import { generateTest } from "../src/codegen";
import type { OperationInfo } from "../src/openapi";

const sampleYaml = readFileSync(resolve(__dirname, "../sample-openapi.yaml"), "utf-8");
const spec = parseSpec(sampleYaml);
const ops = listOperations(spec);
const byKey = (key: string) => ops.find((o) => o.key === key)!;

describe("generateTest: GET /pets (no auth, query params, object response)", () => {
  const output = generateTest(spec, byKey("GET /pets"));

  it("emits a describe/test block titled from the summary", () => {
    expect(output).toContain(`test.describe('GET /pets', () => {`);
    expect(output).toContain(`test('List pets', async ({ request }) => {`);
  });

  it("builds a params object from query parameters, marking optional ones", () => {
    expect(output).toContain(`limit: 1, // optional`);
    expect(output).toContain(`status: "available",`);
  });

  it("leaves the Authorization header commented out when security is []", () => {
    expect(output).toContain("// Authorization: `Bearer ${process.env.API_TOKEN}`,");
    expect(output).not.toContain("Authorization: `Bearer ${process.env.API_TOKEN ?? '<TOKEN>'}`,");
  });

  it("calls request.get with the resolved base URL and params", () => {
    expect(output).toContain("const response = await request.get(`https://api.example.com/v1/pets`, {");
    expect(output).toContain("params");
  });

  it("asserts the documented success status and a property from the response schema", () => {
    expect(output).toContain("expect(response.status()).toBe(200);");
    expect(output).toContain("expect(body).toHaveProperty('pets');");
  });
});

describe("generateTest: POST /pets (auth required, request body)", () => {
  const output = generateTest(spec, byKey("POST /pets"));

  it("includes a real Authorization placeholder when security applies", () => {
    expect(output).toContain("Authorization: `Bearer ${process.env.API_TOKEN ?? '<TOKEN>'}`,");
  });

  it("generates a request payload from the NewPet schema", () => {
    expect(output).toContain('name: "string"');
    expect(output).toContain('tag: "string"');
  });

  it("posts with the generated payload as the request body", () => {
    expect(output).toContain("const response = await request.post(`https://api.example.com/v1/pets`, {");
    expect(output).toContain("data: payload");
  });

  it("asserts the 201 status and a property from the resolved $ref response schema", () => {
    expect(output).toContain("expect(response.status()).toBe(201);");
    expect(output).toContain("expect(body).toHaveProperty('id');");
  });

  it("omits the params block since there are no query parameters", () => {
    expect(output).not.toContain("const params = {");
  });
});

describe("generateTest: GET /pets/{petId} (path param substitution)", () => {
  const output = generateTest(spec, byKey("GET /pets/{petId}"));

  it("substitutes the path parameter with a generated example value", () => {
    expect(output).toContain("`https://api.example.com/v1/pets/string`");
  });

  it("still requires auth via the spec-level security fallback", () => {
    expect(output).toContain("Authorization: `Bearer ${process.env.API_TOKEN ?? '<TOKEN>'}`,");
  });
});

describe("generateTest: edge cases", () => {
  const baseOp: OperationInfo = {
    key: "GET /widgets/{id}",
    method: "get",
    path: "/widgets/{id}",
    parameters: [{ name: "id", in: "path", required: true }],
  };

  it("uses a default string value for a path param with no schema/example", () => {
    const output = generateTest({}, baseOp);
    // Swagger 2.0 params have type directly on the param object (no schema wrapper).
    // A bare param with no type info resolves to "string" rather than the old <id> placeholder.
    expect(output).toContain("'/widgets/string'");
  });

  it("uses a quoted literal path (no template) when the spec has no servers", () => {
    const output = generateTest({}, baseOp);
    expect(output).not.toContain("`${");
  });

  it("falls back to expect(response.ok()) when there is no documented 2xx response", () => {
    const output = generateTest({}, { ...baseOp, responses: { "404": { description: "Not found" } } });
    expect(output).toContain("expect(response.ok()).toBeTruthy();");
  });

  it("uses the operationId as the test title when there is no summary", () => {
    const output = generateTest({}, { ...baseOp, operationId: "getWidget" });
    expect(output).toContain(`test('getWidget', async ({ request }) => {`);
  });

  it("falls back to METHOD /path as the title when neither summary nor operationId exist", () => {
    const output = generateTest({}, baseOp);
    expect(output).toContain(`test('GET /widgets/{id}', async ({ request }) => {`);
  });

  it("leaves Authorization commented out when the operation has no security at all", () => {
    const output = generateTest({}, baseOp);
    expect(output).toContain("// Authorization: `Bearer ${process.env.API_TOKEN}`,");
  });

  it("omits the request body block when the operation has no requestBody", () => {
    const output = generateTest({}, baseOp);
    expect(output).not.toContain("data:");
  });
});
