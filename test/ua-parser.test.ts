import { describe, it, expect } from "vitest";
import { parseUA } from "../src/lib/ua-parser";

describe("parseUA", () => {
  it("detects Chrome on Windows", () => {
    const result = parseUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    expect(result.browser).toBe("Chrome");
    expect(result.os).toBe("Windows");
  });

  it("detects Safari on macOS", () => {
    const result = parseUA(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    );
    expect(result.browser).toBe("Safari");
    expect(result.os).toBe("macOS");
  });

  it("detects Firefox on Linux", () => {
    const result = parseUA(
      "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
    );
    expect(result.browser).toBe("Firefox");
    expect(result.os).toBe("Linux");
  });

  it("detects Edge on Windows", () => {
    const result = parseUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    );
    expect(result.browser).toBe("Edge");
    expect(result.os).toBe("Windows");
  });

  it("detects Chrome on Android", () => {
    const result = parseUA(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    );
    expect(result.browser).toBe("Chrome");
    expect(result.os).toBe("Android");
  });

  it("detects Safari on iOS", () => {
    const result = parseUA(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );
    expect(result.browser).toBe("Safari");
    expect(result.os).toBe("iOS");
  });

  it("returns Other for unknown UA", () => {
    const result = parseUA("curl/7.88.0");
    expect(result.browser).toBe("Other");
    expect(result.os).toBe("Other");
  });

  it("handles empty string", () => {
    const result = parseUA("");
    expect(result.browser).toBe("Other");
    expect(result.os).toBe("Other");
  });
});
