// Decides whether the "Download full suite" button should stay disabled because the
// currently loaded spec is the same one the user already downloaded — vs. a genuinely
// new/changed spec (re-upload, re-paste, fetched URL, or edited endpoints), which
// should re-enable it. Pure and DOM-free so it's unit testable without main.ts's wiring.

// JSON.stringify is enough here: it's compared against a signature computed the same
// way from the same parsed-spec shape, so key order is stable run-to-run for identical
// input text. It doesn't need to be a content hash — just distinguish "identical" from
// "different" for two in-memory spec objects.
export function computeSpecSignature(spec: any): string {
  return JSON.stringify(spec ?? null);
}

export function isSuiteAlreadyDownloaded(spec: any, lastDownloadedSignature: string | null): boolean {
  if (lastDownloadedSignature === null) return false;
  return computeSpecSignature(spec) === lastDownloadedSignature;
}
