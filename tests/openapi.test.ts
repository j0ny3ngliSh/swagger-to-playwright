import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseSpec,
  resolveRef,
  resolveSchema,
  listOperations,
  getBaseUrl,
} from "../src/openapi";

const sampleYaml = readFileSync(resolve(__dirname, "../sample-openapi.yaml"), "utf-8");

describe("parseSpec", () => {
  it("parses a YAML spec", () => {
    const spec = parseSpec(sampleYaml);
    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.title).toBe("Sample Pet Store API");
  });

  it("parses a JSON spec", () => {
    const spec = parseSpec(JSON.stringify({ openapi: "3.0.0", paths: {} }));
    expect(spec.openapi).toBe("3.0.0");
  });
});

describe("resolveRef", () => {
  const spec = parseSpec(sampleYaml);

  it("resolves a valid $ref path", () => {
    const pet = resolveRef(spec, "#/components/schemas/Pet");
    expect(pet).toEqual(spec.components.schemas.Pet);
  });

  it("returns undefined for a non-$ref-shaped string", () => {
    expect(resolveRef(spec, "components/schemas/Pet")).toBeUndefined();
  });

  it("returns undefined for a missing path", () => {
    expect(resolveRef(spec, "#/components/schemas/DoesNotExist")).toBeUndefined();
  });

  it("returns undefined for an empty ref", () => {
    expect(resolveRef(spec, "")).toBeUndefined();
  });
});

describe("resolveSchema", () => {
  const spec = parseSpec(sampleYaml);

  it("returns the schema unchanged when there is no $ref", () => {
    const schema = { type: "string" };
    expect(resolveSchema(spec, schema)).toBe(schema);
  });

  it("resolves a $ref to the referenced schema", () => {
    const resolved = resolveSchema(spec, { $ref: "#/components/schemas/Pet" });
    expect(resolved).toEqual(spec.components.schemas.Pet);
  });

  it("returns the input for null/undefined schema", () => {
    expect(resolveSchema(spec, undefined)).toBeUndefined();
    expect(resolveSchema(spec, null)).toBeNull();
  });

  it("does not infinite-loop on a circular $ref", () => {
    const circularSpec = {
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/A" },
        },
      },
    };
    const result = resolveSchema(circularSpec, { $ref: "#/components/schemas/A" });
    expect(result).toEqual({});
  });
});

describe("listOperations", () => {
  const spec = parseSpec(sampleYaml);
  const ops = listOperations(spec);

  it("extracts every operation across all paths", () => {
    expect(ops.map((o) => o.key).sort()).toEqual(
      ["GET /pets", "GET /pets/{petId}", "POST /pets"].sort(),
    );
  });

  it("merges path-level and operation-level parameters", () => {
    const listPets = ops.find((o) => o.key === "GET /pets")!;
    expect(listPets.parameters.map((p) => p.name).sort()).toEqual(["limit", "status"]);
  });

  it("falls back to spec-level security when the operation doesn't declare its own", () => {
    const createPet = ops.find((o) => o.key === "POST /pets")!;
    expect(createPet.security).toEqual(spec.security);
  });

  it("respects an operation-level empty security override", () => {
    const listPets = ops.find((o) => o.key === "GET /pets")!;
    expect(listPets.security).toEqual([]);
  });

  it("captures the requestBody on operations that declare one", () => {
    const createPet = ops.find((o) => o.key === "POST /pets")!;
    expect(createPet.requestBody).toBeDefined();
    expect(createPet.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/NewPet",
    );
  });

  it("returns an empty list for a spec with no paths", () => {
    expect(listOperations({})).toEqual([]);
  });
});

describe("getBaseUrl", () => {
  it("returns the first server URL when present", () => {
    const spec = parseSpec(sampleYaml);
    expect(getBaseUrl(spec)).toBe("https://api.example.com/v1");
  });

  it("returns an empty string when there are no servers", () => {
    expect(getBaseUrl({})).toBe("");
    expect(getBaseUrl({ servers: [] })).toBe("");
  });
});
