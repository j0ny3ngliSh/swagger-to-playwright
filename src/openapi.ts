import * as yaml from "js-yaml";

export interface OperationInfo {
  key: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
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
      ops.push({
        key: `${method.toUpperCase()} ${path}`,
        method,
        path,
        operationId: op.operationId,
        summary: op.summary,
        parameters: [...pathLevelParams, ...(op.parameters || [])],
        requestBody: op.requestBody,
        responses: op.responses,
        security: op.security || spec.security,
      });
    }
  }
  return ops;
}

export function getBaseUrl(spec: any): string {
  const servers = spec.servers;
  if (servers && servers.length > 0 && servers[0].url) {
    return servers[0].url;
  }
  return "";
}
