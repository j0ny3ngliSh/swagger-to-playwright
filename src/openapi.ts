import * as yaml from "js-yaml";

export interface OperationInfo {
  key: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters: any[];
  requestBody?: any;
  responses?: any;
  security?: any[];
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function parseSpec(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(raw);
  }
  return yaml.load(raw);
}

// Distinguishes an actual OpenAPI/Swagger document from arbitrary YAML/JSON that
// happens to parse successfully but isn't a spec at all.
export function isOpenApiSpec(spec: any): boolean {
  if (!spec || typeof spec !== "object") return false;
  if (typeof spec.openapi === "string" && /^\d/.test(spec.openapi)) return true;
  if (typeof spec.swagger === "string" && /^\d/.test(spec.swagger)) return true;
  return false;
}

// The version string (e.g. "3.0.0", "2.0") — used for lightweight analytics only,
// never the spec body itself.
export function getSpecVersion(spec: any): string | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  return spec.openapi ?? spec.swagger;
}

export function resolveRef(spec: any, ref: string): any {
  if (!ref || !ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let node = spec;
  for (const part of parts) {
    if (node == null) return undefined;
    node = node[part];
  }
  return node;
}

export function resolveSchema(spec: any, schema: any, seen = new Set<string>()): any {
  if (!schema) return schema;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return {};
    seen.add(schema.$ref);
    return resolveSchema(spec, resolveRef(spec, schema.$ref), seen);
  }
  // Merge allOf sub-schemas: combine properties and required arrays.
  // Only handles the common object-merge case — not full JSON Schema composition.
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const base: any = { ...schema };
    delete base.allOf;
    for (const sub of schema.allOf) {
      const resolved = resolveSchema(spec, sub, seen);
      if (!resolved) continue;
      if (resolved.properties) {
        base.properties = { ...(base.properties ?? {}), ...resolved.properties };
      }
      if (Array.isArray(resolved.required)) {
        base.required = [...new Set([...(base.required ?? []), ...resolved.required])];
      }
      if (resolved.type && !base.type) {
        base.type = resolved.type;
      }
    }
    return base;
  }
  return schema;
}

export function listOperations(spec: any): OperationInfo[] {
  const ops: OperationInfo[] = [];
  const paths = spec.paths || {};
  for (const path of Object.keys(paths)) {
    const pathItem = paths[path];
    const pathLevelParams = pathItem.parameters || [];
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      const allParams = [...pathLevelParams, ...(op.parameters || [])];

      // Swagger 2.0 uses `in: "body"` parameters instead of a top-level requestBody.
      // Lift body params out so the rest of the pipeline can treat them uniformly.
      const bodyParam = allParams.find((p: any) => p.in === "body");
      const filteredParams = allParams.filter((p: any) => p.in !== "body");
      const requestBody =
        op.requestBody ??
        (bodyParam?.schema
          ? { content: { "application/json": { schema: bodyParam.schema } } }
          : undefined);

      ops.push({
        key: `${method.toUpperCase()} ${path}`,
        method,
        path,
        operationId: op.operationId,
        summary: op.summary,
        tags: op.tags,
        parameters: filteredParams,
        requestBody,
        responses: op.responses,
        security: op.security || spec.security,
      });
    }
  }
  return ops;
}

export function getBaseUrl(spec: any): string {
  // OpenAPI 3.0
  if (spec.servers?.length > 0 && spec.servers[0].url) {
    return spec.servers[0].url;
  }
  // Swagger 2.0
  if (spec.host) {
    const scheme = spec.schemes?.[0] ?? "https";
    const basePath = spec.basePath ?? "";
    return `${scheme}://${spec.host}${basePath}`;
  }
  return "";
}
