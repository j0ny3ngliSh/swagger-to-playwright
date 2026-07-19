// Hand-written regex-based syntax highlighting — no external dependency.
// Colors match VS Code's default Dark+ theme (applied via .tok-* classes in style.css):
//   tok-key #9CDCFE · tok-str #CE9178 · tok-kw #569CD6 · tok-kwctrl #C586C0
//   tok-num #B5CEA8 · tok-com #6A9955 · tok-fn #DCDCAA
//
// This is deliberately a best-effort tokenizer, not a real parser: good enough for the
// spec/test content this app actually displays, not a general-purpose highlighter.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const YAML_PATTERN =
  /(?<comment>(?:^|(?<=\s))#.*$)|(?<dstr>"(?:[^"\\]|\\.)*")|(?<sstr>'(?:[^'\\]|\\.)*')|(?<key>^\s*(?:-\s+)?(?:[A-Za-z0-9_$./-]+|"[^"]*"|'[^']*')(?=\s*:(\s|$)))|(?<bool>\b(?:true|false|null)\b)|(?<num>-?\b\d+(?:\.\d+)?\b)/gm;

export function highlightYaml(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(YAML_PATTERN, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    if (groups.comment !== undefined) return `<span class="tok-com">${match}</span>`;
    if (groups.dstr !== undefined || groups.sstr !== undefined) return `<span class="tok-str">${match}</span>`;
    if (groups.key !== undefined) return `<span class="tok-key">${match}</span>`;
    if (groups.bool !== undefined) return `<span class="tok-kw">${match}</span>`;
    if (groups.num !== undefined) return `<span class="tok-num">${match}</span>`;
    return match;
  });
}

const JSON_PATTERN =
  /(?<key>"(?:[^"\\]|\\.)*"(?=\s*:))|(?<str>"(?:[^"\\]|\\.)*")|(?<bool>\btrue\b|\bfalse\b|\bnull\b)|(?<num>-?\b\d+(?:\.\d+)?\b)/g;

export function highlightJson(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(JSON_PATTERN, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    if (groups.key !== undefined) return `<span class="tok-key">${match}</span>`;
    if (groups.str !== undefined) return `<span class="tok-str">${match}</span>`;
    if (groups.bool !== undefined) return `<span class="tok-kw">${match}</span>`;
    if (groups.num !== undefined) return `<span class="tok-num">${match}</span>`;
    return match;
  });
}

// Matches parseSpec's own JSON-vs-YAML detection in openapi.ts, so highlighting always
// agrees with how the content will actually be parsed.
export function highlightSpec(text: string): string {
  return text.trim().startsWith("{") ? highlightJson(text) : highlightYaml(text);
}

const TS_STORAGE_KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "class",
  "new",
  "extends",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "void",
  "typeof",
  "instanceof",
]);
const TS_CONTROL_KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "default",
  "return",
  "if",
  "else",
  "for",
  "while",
  "of",
  "in",
  "switch",
  "case",
  "break",
  "continue",
  "try",
  "catch",
  "throw",
]);

const TS_PATTERN =
  /(?<comment>\/\/.*$)|(?<tpl>`(?:[^`\\]|\\.)*`)|(?<dstr>"(?:[^"\\]|\\.)*")|(?<sstr>'(?:[^'\\]|\\.)*')|(?<num>\b\d+(?:\.\d+)?\b)|(?<key>[A-Za-z_$][A-Za-z0-9_$]*(?=\s*:\s*[^:]))|(?<fncall>[A-Za-z_$][A-Za-z0-9_$]*(?=\())|(?<ident>[A-Za-z_$][A-Za-z0-9_$]*)/gm;

export function highlightTs(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(TS_PATTERN, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    if (groups.comment !== undefined) return `<span class="tok-com">${match}</span>`;
    if (groups.tpl !== undefined || groups.dstr !== undefined || groups.sstr !== undefined) {
      return `<span class="tok-str">${match}</span>`;
    }
    if (groups.num !== undefined) return `<span class="tok-num">${match}</span>`;
    if (groups.key !== undefined) return `<span class="tok-key">${match}</span>`;
    if (groups.fncall !== undefined) return `<span class="tok-fn">${match}</span>`;
    if (groups.ident !== undefined) {
      if (TS_STORAGE_KEYWORDS.has(match)) return `<span class="tok-kw">${match}</span>`;
      if (TS_CONTROL_KEYWORDS.has(match)) return `<span class="tok-kwctrl">${match}</span>`;
      return match;
    }
    return match;
  });
}
