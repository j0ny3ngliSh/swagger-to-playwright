import { describe, it, expect } from "vitest";
import { escapeHtml, highlightYaml, highlightJson, highlightSpec, highlightTs } from "../src/highlight";

describe("escapeHtml", () => {
  it("escapes &, <, > but leaves quotes alone", () => {
    expect(escapeHtml(`a < b & c > "d" 'e'`)).toBe(`a &lt; b &amp; c &gt; "d" 'e'`);
  });
});

describe("highlightYaml", () => {
  it("colors a mapping key", () => {
    expect(highlightYaml("openapi: 3.0.0")).toContain('<span class="tok-key">openapi</span>');
  });

  it("colors a quoted string value", () => {
    const out = highlightYaml('title: "Sample Pet Store API"');
    expect(out).toContain('<span class="tok-str">"Sample Pet Store API"</span>');
  });

  it("colors a numeric value", () => {
    expect(highlightYaml("count: 42")).toContain('<span class="tok-num">42</span>');
  });

  it("colors true/false/null as keywords", () => {
    expect(highlightYaml("required: true")).toContain('<span class="tok-kw">true</span>');
  });

  it("colors a comment", () => {
    expect(highlightYaml("foo: bar # a comment")).toContain('<span class="tok-com"># a comment</span>');
  });

  it("does not treat a # inside a quoted string as a comment", () => {
    const out = highlightYaml('$ref: "#/components/schemas/Pet"');
    expect(out).toContain('<span class="tok-str">"#/components/schemas/Pet"</span>');
    expect(out).not.toContain("tok-com");
  });

  it("escapes HTML-significant characters", () => {
    expect(highlightYaml("title: <script>")).toContain("&lt;script&gt;");
  });
});

describe("highlightJson", () => {
  it("colors an object key distinctly from a string value", () => {
    const out = highlightJson('{"name": "doggie"}');
    expect(out).toContain('<span class="tok-key">"name"</span>');
    expect(out).toContain('<span class="tok-str">"doggie"</span>');
  });

  it("colors numbers and booleans", () => {
    const out = highlightJson('{"id": 10, "active": true}');
    expect(out).toContain('<span class="tok-num">10</span>');
    expect(out).toContain('<span class="tok-kw">true</span>');
  });
});

describe("highlightSpec", () => {
  it("dispatches to the JSON highlighter for content starting with {", () => {
    expect(highlightSpec('{"openapi": "3.0.0"}')).toContain('<span class="tok-key">"openapi"</span>');
  });

  it("dispatches to the YAML highlighter otherwise", () => {
    expect(highlightSpec("openapi: 3.0.0")).toContain('<span class="tok-key">openapi</span>');
  });
});

describe("highlightTs", () => {
  it("colors storage keywords", () => {
    const out = highlightTs("const payload = {};");
    expect(out).toContain('<span class="tok-kw">const</span>');
  });

  it("colors control keywords distinctly from storage keywords", () => {
    const out = highlightTs("import { test } from '@playwright/test';");
    expect(out).toContain('<span class="tok-kwctrl">import</span>');
    expect(out).toContain('<span class="tok-kwctrl">from</span>');
  });

  it("colors a line comment", () => {
    expect(highlightTs("// a comment")).toBe('<span class="tok-com">// a comment</span>');
  });

  it("colors a template literal as a string", () => {
    const out = highlightTs("const url = `https://api.example.com/pets`;");
    expect(out).toContain('<span class="tok-str">`https://api.example.com/pets`</span>');
  });

  it("does not treat // inside a template literal URL as a comment", () => {
    const out = highlightTs("await request.get(`https://api.example.com/pets`);");
    expect(out).not.toContain("tok-com");
  });

  it("colors a method call distinctly", () => {
    const out = highlightTs("expect(response.status()).toBe(200);");
    expect(out).toContain('<span class="tok-fn">status</span>');
    expect(out).toContain('<span class="tok-fn">toBe</span>');
    expect(out).toContain('<span class="tok-num">200</span>');
  });

  it("colors an object literal key", () => {
    const out = highlightTs('const payload = { name: "string" };');
    expect(out).toContain('<span class="tok-key">name</span>');
  });

  it("escapes HTML-significant characters", () => {
    expect(highlightTs("const x: Record<string, string> = {};")).toContain("&lt;string, string&gt;");
  });
});
