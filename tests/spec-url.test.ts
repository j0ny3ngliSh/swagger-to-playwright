import { describe, it, expect } from "vitest";
import { normalizeSpecUrl, looksLikeHtml } from "../src/spec-url";

describe("normalizeSpecUrl", () => {
  it("rewrites a GitHub blob URL to its raw-content equivalent", () => {
    expect(normalizeSpecUrl("https://github.com/j0ny3ngliSh/car-parts-dismantling/blob/main/openapi.yaml")).toBe(
      "https://raw.githubusercontent.com/j0ny3ngliSh/car-parts-dismantling/main/openapi.yaml",
    );
  });

  it("handles a nested path", () => {
    expect(normalizeSpecUrl("https://github.com/acme/api/blob/main/specs/openapi.yaml")).toBe(
      "https://raw.githubusercontent.com/acme/api/main/specs/openapi.yaml",
    );
  });

  it("handles a non-'main' ref (e.g. a version tag or other branch)", () => {
    expect(normalizeSpecUrl("https://github.com/acme/api/blob/v2/openapi.yaml")).toBe(
      "https://raw.githubusercontent.com/acme/api/v2/openapi.yaml",
    );
  });

  it("strips a trailing query string (e.g. GitHub's ?plain=1)", () => {
    expect(normalizeSpecUrl("https://github.com/acme/api/blob/main/openapi.yaml?plain=1")).toBe(
      "https://raw.githubusercontent.com/acme/api/main/openapi.yaml",
    );
  });

  it("strips a trailing line-range fragment", () => {
    expect(normalizeSpecUrl("https://github.com/acme/api/blob/main/openapi.yaml#L10-L20")).toBe(
      "https://raw.githubusercontent.com/acme/api/main/openapi.yaml",
    );
  });

  it("leaves an already-raw GitHub URL unchanged", () => {
    const raw = "https://raw.githubusercontent.com/acme/api/main/openapi.yaml";
    expect(normalizeSpecUrl(raw)).toBe(raw);
  });

  it("leaves non-GitHub URLs unchanged", () => {
    const url = "https://api.example.com/openapi.yaml";
    expect(normalizeSpecUrl(url)).toBe(url);
  });

  it("leaves GitHub URLs that aren't blob links unchanged", () => {
    const url = "https://github.com/acme/api";
    expect(normalizeSpecUrl(url)).toBe(url);
  });
});

describe("looksLikeHtml", () => {
  it("detects a doctype-prefixed HTML page", () => {
    expect(looksLikeHtml("<!doctype html>\n<html>...</html>")).toBe(true);
  });

  it("detects an HTML page without a doctype, with leading whitespace", () => {
    expect(looksLikeHtml("   \n<html><head></head></html>")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(looksLikeHtml("<!DOCTYPE HTML><HTML></HTML>")).toBe(true);
  });

  it("is false for YAML spec content", () => {
    expect(looksLikeHtml("openapi: 3.0.0\ninfo:\n  title: Test\n")).toBe(false);
  });

  it("is false for JSON spec content", () => {
    expect(looksLikeHtml('{"openapi": "3.0.0"}')).toBe(false);
  });
});
