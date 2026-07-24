// Rewrites a GitHub "view this file in the browser" URL (a blob URL) to its
// raw-content equivalent. Pasting the page you were just looking at — instead
// of the raw file — is an easy, common mistake, and GitHub is overwhelmingly
// the most likely host for someone sharing a spec this way.
const GITHUB_BLOB_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/([^?#]+)/;

export function normalizeSpecUrl(url: string): string {
  const match = url.match(GITHUB_BLOB_URL);
  if (!match) return url;
  const [, owner, repo, ref, path] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

// Cheap check for "this is an HTML page, not spec content" — turns a
// confusing downstream YAML/JSON parse error into an actionable one for URLs
// that couldn't be auto-rewritten (e.g. a non-GitHub viewer page).
export function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype html|html)/i.test(text);
}
