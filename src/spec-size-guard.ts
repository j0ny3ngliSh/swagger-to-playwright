// Guards against pasting/uploading something huge enough to freeze the tab while
// js-yaml/JSON parses it and the UI re-renders. Matches the 2MB cap api/fetch-spec.ts
// already enforces server-side for the URL-fetch path — this covers the other two
// load paths (paste, file upload), which never go through that endpoint.
export const MAX_SPEC_CHARS = 1_000_000;

export function isSpecTooLarge(text: string): boolean {
  return text.length > MAX_SPEC_CHARS;
}
