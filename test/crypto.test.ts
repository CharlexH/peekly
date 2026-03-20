import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signJWT, verifyJWT } from "../src/lib/crypto";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("mysecret");
    expect(hash).toContain(":");
    const valid = await verifyPassword("mysecret", hash);
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("mysecret");
    const valid = await verifyPassword("wrong", hash);
    expect(valid).toBe(false);
  });

  it("produces different hashes for same password (different salt)", async () => {
    const a = await hashPassword("mysecret");
    const b = await hashPassword("mysecret");
    expect(a).not.toBe(b);
  });

  it("rejects malformed hash", async () => {
    const valid = await verifyPassword("test", "notahash");
    expect(valid).toBe(false);
  });
});

describe("JWT", () => {
  const secret = "test-secret-key";

  it("signs and verifies a JWT", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: "admin", iat: now, exp: now + 3600 }, secret);
    expect(token.split(".")).toHaveLength(3);

    const payload = await verifyJWT(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("admin");
  });

  it("rejects expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: "admin", iat: now - 7200, exp: now - 3600 }, secret);
    const payload = await verifyJWT(token, secret);
    expect(payload).toBeNull();
  });

  it("rejects token with wrong secret", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: "admin", iat: now, exp: now + 3600 }, secret);
    const payload = await verifyJWT(token, "wrong-secret");
    expect(payload).toBeNull();
  });

  it("rejects malformed token", async () => {
    const payload = await verifyJWT("not.a.valid.token", secret);
    expect(payload).toBeNull();
  });

  it("rejects token with only 2 parts", async () => {
    const payload = await verifyJWT("part1.part2", secret);
    expect(payload).toBeNull();
  });
});
