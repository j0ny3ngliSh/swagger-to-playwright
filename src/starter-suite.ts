import type { OperationInfo } from "./openapi";
import { resolveSchema, getBaseUrl } from "./openapi";
import { exampleForSchema, paramExample, buildPath, firstSuccessResponse, escape } from "./codegen";

const PAGINATION_PARAM_NAMES = /^(page|limit|offset|cursor|per_?page|page_?size|page_?number)$/i;
const UNDOCUMENTED_STATUS_COMMENT =
  "    // Expected status isn't documented in the spec for this case — fill in once known.";

interface TestCase {
  title: string;
  includeAuth: boolean;
  pathExpr: string;
  queryParams?: Record<string, any>;
  payload?: any;
  assertionLines: string[];
}

function getBodySchema(spec: any, op: OperationInfo): any {
  const content = op.requestBody?.content?.["application/json"];
  return content?.schema ? resolveSchema(spec, content.schema) : undefined;
}

function pickTypedProperty(schema: any): { name: string; type: string } | undefined {
  if (!schema?.properties) return undefined;
  for (const [name, propSchema] of Object.entries<any>(schema.properties)) {
    const resolved = propSchema;
    if (["string", "integer", "number", "boolean"].includes(resolved?.type)) {
      return { name, type: resolved.type };
    }
  }
  return undefined;
}

function wrongTypeValue(type: string): any {
  switch (type) {
    case "string":
      return 12345;
    case "integer":
    case "number":
      return "not-a-number";
    case "boolean":
      return "not-a-boolean";
    default:
      return null;
  }
}

function pathParamHasMeaningfulFormat(schema: any): boolean {
  if (!schema) return false;
  if (schema.type === "integer" || schema.type === "number") return true;
  if (schema.format && ["uuid", "email", "date", "date-time"].includes(schema.format)) return true;
  if (schema.pattern) return true;
  if (schema.enum) return true;
  return false;
}

function invalidPathParamValue(schema: any): string {
  if (schema?.type === "integer" || schema?.type === "number") return "not-a-number";
  if (schema?.format === "uuid") return "not-a-uuid";
  if (schema?.format === "email") return "not-an-email";
  if (schema?.format === "date" || schema?.format === "date-time") return "not-a-date";
  if (schema?.pattern) return "invalid-pattern-value";
  if (schema?.enum) return "invalid-enum-value";
  return "invalid";
}

function documentedStatus(op: OperationInfo, candidates: string[]): string | undefined {
  const responses = op.responses || {};
  return candidates.find((c) => responses[c]);
}

function buildPathWithOverride(spec: any, op: OperationInfo, overrideName: string, overrideValue: string): string {
  let path = op.path;
  const pathParams = op.parameters.filter((p) => p.in === "path");
  for (const p of pathParams) {
    const value = p.name === overrideName ? overrideValue : paramExample(spec, p);
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
  }
  return path;
}

function renderCase(c: TestCase, method: string, baseUrl: string): string[] {
  const lines: string[] = [];
  lines.push(`  test('${escape(c.title)}', async ({ request }) => {`);

  if (c.queryParams) {
    lines.push(`    const params = ${JSON.stringify(c.queryParams)};`);
    lines.push("");
  }

  lines.push(`    const headers: Record<string, string> = {`);
  if (c.includeAuth) {
    lines.push(`      Authorization: \`Bearer \${process.env.API_TOKEN ?? '<TOKEN>'}\`,`);
  }
  lines.push(`    };`);
  lines.push("");

  if (c.payload !== undefined) {
    lines.push(`    const payload = ${JSON.stringify(c.payload, null, 2).replace(/\n/g, "\n    ")};`);
    lines.push("");
  }

  const urlExpr = baseUrl ? `\`${baseUrl}${c.pathExpr}\`` : `'${c.pathExpr}'`;
  const optionsParts: string[] = ["headers"];
  if (c.queryParams) optionsParts.push("params");
  if (c.payload !== undefined) optionsParts.push("data: payload");

  lines.push(`    const response = await request.${method}(${urlExpr}, {`);
  lines.push(`      ${optionsParts.join(",\n      ")},`);
  lines.push(`    });`);
  lines.push("");
  lines.push(...c.assertionLines);
  lines.push(`  });`);
  lines.push("");
  return lines;
}

export function generateStarterSuite(spec: any, op: OperationInfo): string {
  const baseUrl = getBaseUrl(spec);
  const { pathExpr: happyPath, queryParams: allQueryParams } = buildPath(spec, op);
  const pathParams = op.parameters.filter((p) => p.in === "path");
  const hasPathParam = pathParams.length > 0;
  const hasAuth = Boolean(op.security && op.security.length > 0);
  const success = firstSuccessResponse(op);
  const bodySchema = getBodySchema(spec, op);
  const requiredBodyFields: string[] = bodySchema?.required ?? [];
  const typedProp = pickTypedProperty(bodySchema);
  const isCollectionGet = op.method === "get" && !hasPathParam;
  const paginationParam = isCollectionGet ? allQueryParams.find((p) => PAGINATION_PARAM_NAMES.test(p.name)) : undefined;

  const happyQuery =
    allQueryParams.length > 0
      ? Object.fromEntries(allQueryParams.map((p) => [p.name, paramExample(spec, p)]))
      : undefined;
  const happyPayload = op.requestBody
    ? exampleForSchema(spec, op.requestBody.content?.["application/json"]?.schema)
    : undefined;

  const happyAssertions: string[] = [];
  if (success) {
    happyAssertions.push(`    expect(response.status()).toBe(${success.code});`);
    const schema = success.schema ? resolveSchema(spec, success.schema) : undefined;
    if (schema?.properties) {
      const firstProp = Object.keys(schema.properties)[0];
      if (firstProp) {
        happyAssertions.push(`    const body = await response.json();`);
        happyAssertions.push(`    expect(body).toHaveProperty('${firstProp}');`);
      }
    }
  } else {
    happyAssertions.push(`    expect(response.ok()).toBeTruthy();`);
  }

  const cases: TestCase[] = [];

  cases.push({
    title: op.summary ? `${op.summary} (happy path)` : `${op.method.toUpperCase()} ${op.path} succeeds`,
    includeAuth: hasAuth,
    pathExpr: happyPath,
    queryParams: happyQuery,
    payload: happyPayload,
    assertionLines: happyAssertions,
  });

  if (hasPathParam) {
    const targetParam = pathParams[pathParams.length - 1];
    const notFoundCode = documentedStatus(op, ["404"]);
    cases.push({
      title: `returns ${notFoundCode ?? "an error"} for a non-existent ${targetParam.name}`,
      includeAuth: hasAuth,
      pathExpr: buildPathWithOverride(spec, op, targetParam.name, "nonexistent-id-000000"),
      queryParams: happyQuery,
      payload: happyPayload,
      assertionLines: notFoundCode
        ? [`    expect(response.status()).toBe(${notFoundCode});`]
        : [UNDOCUMENTED_STATUS_COMMENT],
    });

    const targetSchema = resolveSchema(spec, targetParam.schema);
    if (pathParamHasMeaningfulFormat(targetSchema)) {
      const badCode = documentedStatus(op, ["400", "422"]);
      cases.push({
        title: `returns ${badCode ?? "an error"} for an invalid ${targetParam.name} format`,
        includeAuth: hasAuth,
        pathExpr: buildPathWithOverride(spec, op, targetParam.name, invalidPathParamValue(targetSchema)),
        queryParams: happyQuery,
        payload: happyPayload,
        assertionLines: badCode ? [`    expect(response.status()).toBe(${badCode});`] : [UNDOCUMENTED_STATUS_COMMENT],
      });
    }
  }

  if (requiredBodyFields.length > 0 && happyPayload && typeof happyPayload === "object") {
    const missingField = requiredBodyFields[0];
    const partialPayload = { ...happyPayload };
    delete partialPayload[missingField];
    const code = documentedStatus(op, ["400", "422"]);
    cases.push({
      title: `returns ${code ?? "an error"} when '${missingField}' is missing`,
      includeAuth: hasAuth,
      pathExpr: happyPath,
      queryParams: happyQuery,
      payload: partialPayload,
      assertionLines: code ? [`    expect(response.status()).toBe(${code});`] : [UNDOCUMENTED_STATUS_COMMENT],
    });
  }

  if (typedProp && happyPayload && typeof happyPayload === "object") {
    const badPayload = { ...happyPayload, [typedProp.name]: wrongTypeValue(typedProp.type) };
    const code = documentedStatus(op, ["400", "422"]);
    cases.push({
      title: `returns ${code ?? "an error"} when '${typedProp.name}' has the wrong type`,
      includeAuth: hasAuth,
      pathExpr: happyPath,
      queryParams: happyQuery,
      payload: badPayload,
      assertionLines: code ? [`    expect(response.status()).toBe(${code});`] : [UNDOCUMENTED_STATUS_COMMENT],
    });
  }

  if (paginationParam) {
    const paginationSchema = resolveSchema(spec, paginationParam.schema);
    const validValue =
      paginationSchema?.type === "integer" || paginationSchema?.type === "number"
        ? 2
        : paramExample(spec, paginationParam);
    cases.push({
      title: `supports the '${paginationParam.name}' parameter`,
      includeAuth: hasAuth,
      pathExpr: happyPath,
      queryParams: { ...happyQuery, [paginationParam.name]: validValue },
      payload: undefined,
      assertionLines: happyAssertions,
    });

    if (paginationSchema?.type === "integer" || paginationSchema?.type === "number") {
      const code = documentedStatus(op, ["400", "422"]);
      cases.push({
        title: `rejects an invalid '${paginationParam.name}' value`,
        includeAuth: hasAuth,
        pathExpr: happyPath,
        queryParams: { ...happyQuery, [paginationParam.name]: "not-a-number" },
        payload: undefined,
        assertionLines: code ? [`    expect(response.status()).toBe(${code});`] : [UNDOCUMENTED_STATUS_COMMENT],
      });
    }
  }

  if (hasAuth) {
    const code = documentedStatus(op, ["401", "403"]);
    cases.push({
      title: `requires authentication`,
      includeAuth: false,
      pathExpr: happyPath,
      queryParams: happyQuery,
      payload: happyPayload,
      assertionLines: code
        ? [`    expect(response.status()).toBe(${code});`]
        : ["    // Placeholder: expected status when unauthenticated isn't documented in the spec."],
    });
  }

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push("");
  lines.push(`test.describe('${op.method.toUpperCase()} ${op.path}', () => {`);
  for (const c of cases) {
    lines.push(...renderCase(c, op.method, baseUrl));
  }
  lines.push(`});`);
  lines.push("");
  return lines.join("\n");
}
