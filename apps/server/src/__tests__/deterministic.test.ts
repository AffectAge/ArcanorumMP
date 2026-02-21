import { describe, expect, it } from "vitest";
import { hashToScore } from "../deterministic.js";

describe("hashToScore", () => {
  it("returns deterministic score", () => {
    const a = hashToScore("turn1:countryA:provinceX");
    const b = hashToScore("turn1:countryA:provinceX");
    expect(a).toBe(b);
  });

  it("produces different score for different keys", () => {
    const a = hashToScore("turn1:countryA:provinceX");
    const b = hashToScore("turn1:countryB:provinceX");
    expect(a).not.toBe(b);
  });
});
