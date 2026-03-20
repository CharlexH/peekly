import { describe, it, expect } from "vitest";
import { nanoid } from "../src/lib/nanoid";

describe("nanoid", () => {
  it("generates a string of default length", () => {
    const id = nanoid();
    expect(id).toHaveLength(21);
  });

  it("generates a string of custom length", () => {
    const id = nanoid(12);
    expect(id).toHaveLength(12);
  });

  it("only contains alphanumeric characters", () => {
    const id = nanoid(100);
    expect(id).toMatch(/^[0-9a-zA-Z]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => nanoid()));
    expect(ids.size).toBe(100);
  });
});
