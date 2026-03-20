import { describe, it, expect } from "vitest";
import { generateVisitorHash } from "../src/lib/visitor-hash";

describe("generateVisitorHash", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for same inputs", async () => {
    const a = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt123");
    const b = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt123");
    expect(a).toBe(b);
  });

  it("differs with different IP", async () => {
    const a = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt123");
    const b = await generateVisitorHash("5.6.7.8", "Mozilla/5.0", "salt123");
    expect(a).not.toBe(b);
  });

  it("differs with different UA", async () => {
    const a = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt123");
    const b = await generateVisitorHash("1.2.3.4", "Chrome/120", "salt123");
    expect(a).not.toBe(b);
  });

  it("differs with different salt", async () => {
    const a = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt123");
    const b = await generateVisitorHash("1.2.3.4", "Mozilla/5.0", "salt456");
    expect(a).not.toBe(b);
  });
});
