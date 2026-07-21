import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpec, listOperations } from "../src/openapi";
import { generateStarterSuite } from "../src/starter-suite";

const yaml = readFileSync(resolve(__dirname, "../sample-openapi.yaml"), "utf-8");
const spec = parseSpec(yaml);
const ops = listOperations(spec);

describe("QA: print generated output for all sample endpoints", () => {
  for (const op of ops) {
    it(`output for ${op.key}`, () => {
      const output = generateStarterSuite(spec, op);
      console.log("\n" + "═".repeat(72));
      console.log(`▶  ${op.key}`);
      console.log("═".repeat(72));
      console.log(output);
      console.log("═".repeat(72));
    });
  }
});
