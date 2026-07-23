import { describe, it, expect } from "vitest";
import { MAX_SPEC_CHARS, isSpecTooLarge } from "../src/spec-size-guard";

describe("isSpecTooLarge", () => {
  it("is false for a small spec", () => {
    expect(isSpecTooLarge("openapi: 3.0.0")).toBe(false);
  });

  it("is false right at the limit", () => {
    expect(isSpecTooLarge("a".repeat(MAX_SPEC_CHARS))).toBe(false);
  });

  it("is true just over the limit", () => {
    expect(isSpecTooLarge("a".repeat(MAX_SPEC_CHARS + 1))).toBe(true);
  });

  it("is true for something dramatically oversized", () => {
    expect(isSpecTooLarge("a".repeat(MAX_SPEC_CHARS * 3))).toBe(true);
  });
});
