import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("shared dashboard route", () => {
  it("keeps share-token URLs pointed at the shared dashboard shell", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/shared/demo-token"),
      {} as never,
      {} as never,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/shared/?token=demo-token");
  });
});
