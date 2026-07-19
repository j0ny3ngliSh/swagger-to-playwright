import type { OperationInfo } from "./openapi";
import { resolveSchema, getBaseUrl } from "./openapi";

export function exampleForSchema(spec: any, schema: any, depth = 0): any {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || depth > 5) return null;

  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.enum && resolved.enum.length > 0) return resolved.enum[0];

  const type = resolved.type || (resolved.properties ? "object" : "string");

  switch (type) {
    case "object": {
      const obj: Record<string, any> = {};
      const props = resolved.properties || {};
      const required: string[] = resolved.required || [];
      for (const propName of Object.keys(props)) {
        if (required.includes(propName) || Object.keys(props).length <= 6) {
          obj[propName] = exampleForSchema(spec, props[propName], depth + 1);
        }
      }
      return obj;
    }
    case "array":
      return [exampleForSchema(spec, resolved.items, depth + 1)];
    case "string":
      if (resolved.format === "email") return "user@example.com";
      if (resolved.format === "date-time") return "2026-01-01T00:00:00Z";
      if (resolved.format === "date") return "2026-01-01";
      if (resolved.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      return "string";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return true;
    default:
      return null;
  }
}

export function paramExample(spec: any, param: any): any {
  if (param.example !== undefined) return param.example;
  return exampleForSchema(spec, param.schema);
}

export function buildPath(spec: any, op: OperationInfo): { pathExpr: string; queryParams: any[] } {
  let path = op.path;
  const pathParams = op.parameters.filter((p) => p.in === "path");
  const queryParams = op.parameters.filter((p) => p.in === "query");

  for (const p of pathParams) {
    const value = paramExample(spec, p);
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(value ?? `<${p.name}>`)));
  }

  return { pathExpr: path, queryParams };
}

export function firstSuccessResponse(op: OperationInfo): { code: string; schema?: any } | undefined {
  const responses = op.responses || {};
  const codes = Object.keys(responses).filter((c) => /^2\d\d$/.test(c));
  if (codes.length === 0) return undefined;
  const code = codes[0];
  const content = responses[code]?.content?.["application/json"];
  return { code, schema: content?.schema };
}

export function generateTest(spec: any, op: OperationInfo): string {
  const baseUrl = getBaseUrl(spec);
  const { pathExpr, queryParams } = buildPath(spec, op);
  const title = op.summary || op.operationId || `${op.method.toUpperCase()} ${op.path}`;
  const requiresAuth = Boolean(op.security && op.security.length > 0);

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push("");
  lines.push(`test.describe('${op.method.toUpperCase()} ${op.path}', () => {`);
  lines.push(`  test('${escape(title)}', async ({ request }) => {`);

  if (queryParams.length > 0) {
    lines.push(`    const params = {`);
    for (const p of queryParams) {
      lines.push(`      ${p.name}: ${JSON.stringify(paramExample(spec, p))},${p.required ? "" : " // optional"}`);
    }
    lines.push(`    };`);
    lines.push("");
  }

  lines.push(`    const headers: Record<string, string> = {`);
  if (requiresAuth) {
    lines.push(`      Authorization: \`Bearer \${process.env.API_TOKEN ?? '<TOKEN>'}\`,`);
  } else {
    lines.push(`      // Authorization: \`Bearer \${process.env.API_TOKEN}\`,`);
  }
  lines.push(`    };`);
  lines.push("");

  let bodyVar = "";
  if (op.requestBody) {
    const content = op.requestBody.content?.["application/json"];
    const payload = content?.schema ? exampleForSchema(spec, content.schema) : {};
    bodyVar = "payload";
    lines.push(`    const payload = ${JSON.stringify(payload, null, 2).replace(/\n/g, "\n    ")};`);
    lines.push("");
  }

  const urlExpr = baseUrl ? `\`${baseUrl}${pathExpr}\`` : `'${pathExpr}'`;
  const optionsParts: string[] = [`headers`];
  if (queryParams.length > 0) optionsParts.push(`params`);
  if (bodyVar) optionsParts.push(`data: ${bodyVar}`);

  lines.push(`    const response = await request.${op.method}(${urlExpr}, {`);
  lines.push(`      ${optionsParts.join(",\n      ")},`);
  lines.push(`    });`);
  lines.push("");

  const success = firstSuccessResponse(op);
  if (success) {
    lines.push(`    expect(response.status()).toBe(${success.code});`);
    const schema = success.schema ? resolveSchema(spec, success.schema) : undefined;
    if (schema?.properties) {
      const firstProp = Object.keys(schema.properties)[0];
      if (firstProp) {
        lines.push(`    const body = await response.json();`);
        lines.push(`    expect(body).toHaveProperty('${firstProp}');`);
      }
    }
  } else {
    lines.push(`    expect(response.ok()).toBeTruthy();`);
  }

  lines.push(`  });`);
  lines.push(`});`);
  lines.push("");

  return lines.join("\n");
}

export function escape(s: string): string {
  return s.replace(/'/g, "\\'");
}
