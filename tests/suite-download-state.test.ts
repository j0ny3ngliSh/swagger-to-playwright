import { describe, it, expect } from "vitest";
import { computeSpecSignature, isSuiteAlreadyDownloaded } from "../src/suite-download-state";

const specA = { openapi: "3.0.0", paths: { "/pets": { get: {} } } };
const specB = { openapi: "3.0.0", paths: { "/orders": { get: {} } } };

describe("computeSpecSignature", () => {
  it("produces the same signature for two structurally identical specs", () => {
    const clone = JSON.parse(JSON.stringify(specA));
    expect(computeSpecSignature(specA)).toBe(computeSpecSignature(clone));
  });

  it("produces different signatures for different specs", () => {
    expect(computeSpecSignature(specA)).not.toBe(computeSpecSignature(specB));
  });

  it("handles null/undefined without throwing", () => {
    expect(() => computeSpecSignature(null)).not.toThrow();
    expect(() => computeSpecSignature(undefined)).not.toThrow();
    expect(computeSpecSignature(null)).toBe(computeSpecSignature(undefined));
  });
});

describe("isSuiteAlreadyDownloaded", () => {
  it("is false when nothing has been downloaded yet (null signature)", () => {
    expect(isSuiteAlreadyDownloaded(specA, null)).toBe(false);
  });

  it("is true when the current spec matches the last-downloaded signature", () => {
    const signature = computeSpecSignature(specA);
    expect(isSuiteAlreadyDownloaded(specA, signature)).toBe(true);
  });

  it("is true for a re-parsed but structurally identical spec (same text reloaded)", () => {
    const signature = computeSpecSignature(specA);
    const reparsed = JSON.parse(JSON.stringify(specA));
    expect(isSuiteAlreadyDownloaded(reparsed, signature)).toBe(true);
  });

  it("is false once the spec changes (re-upload/paste of different content)", () => {
    const signature = computeSpecSignature(specA);
    expect(isSuiteAlreadyDownloaded(specB, signature)).toBe(false);
  });

  it("is false when endpoints change on an otherwise similar spec", () => {
    const signature = computeSpecSignature(specA);
    const withExtraEndpoint = { ...specA, paths: { ...specA.paths, "/orders": { get: {} } } };
    expect(isSuiteAlreadyDownloaded(withExtraEndpoint, signature)).toBe(false);
  });
});
