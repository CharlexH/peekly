import { describe, expect, it } from "vitest";

async function loadI18n() {
  (globalThis as any).window = globalThis;
  // @ts-expect-error public browser helper is authored as plain JavaScript.
  await import("../public/i18n.js");
  return (globalThis as any).PeeklyI18n;
}

describe("PeeklyI18n", () => {
  it("defaults the product UI to Chinese with English fallback coverage", async () => {
    const i18n = await loadI18n();

    expect(i18n.defaultLocale).toBe("zh");
    expect(i18n.t("zh", "nav.sites")).toBe("站点");
    expect(i18n.t("en", "nav.sites")).toBe("Sites");
    expect(i18n.t("zh", "missing.key")).toBe("missing.key");
  });

  it("normalizes unsupported locales to the Chinese default", async () => {
    const i18n = await loadI18n();

    expect(i18n.normalizeLocale("zh-CN")).toBe("zh");
    expect(i18n.normalizeLocale("en-US")).toBe("en");
    expect(i18n.normalizeLocale("fr")).toBe("zh");
  });

  it("keeps Chinese and English dictionaries structurally aligned", async () => {
    const i18n = await loadI18n();
    const zhKeys = Object.keys(i18n.messages.zh).sort();
    const enKeys = Object.keys(i18n.messages.en).sort();

    expect(zhKeys).toEqual(enKeys);
  });
});
