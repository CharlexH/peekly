import { describe, expect, it } from "vitest";
// @ts-expect-error public browser helper is authored as plain ESM JavaScript.
import { buildCountryBubbleSpecs, bubbleVisual } from "../public/globe-bubbles.js";

describe("bubbleVisual", () => {
  it("keeps low-volume countries visible while preserving scale differences", () => {
    const low = bubbleVisual(5, 200);
    const high = bubbleVisual(200, 200);

    expect(low.radius).toBeGreaterThan(0.03);
    expect(low.height).toBeGreaterThan(0.01);
    expect(low.opacity).toBeGreaterThan(0.2);

    expect(high.radius).toBeGreaterThan(low.radius);
    expect(high.height).toBeGreaterThan(low.height);
    expect(high.opacity).toBeGreaterThan(low.opacity);
  });
});

describe("buildCountryBubbleSpecs", () => {
  it("filters out countries without coordinates or usable traffic", () => {
    const specs = buildCountryBubbleSpecs(
      [
        { country: "US", visitors: 120 },
        { country: "ZZ", visitors: 90 },
        { country: "CN", visitors: 0 },
        { country: "JP", visitors: -5 },
      ],
      {
        US: [39.8, -98.6],
        CN: [35, 105],
      },
    );

    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      country: "US",
      lat: 39.8,
      lng: -98.6,
      visitors: 120,
    });
  });

  it("sorts the strongest countries first so larger domes render underneath smaller ones", () => {
    const specs = buildCountryBubbleSpecs(
      [
        { country: "CN", visitors: 40 },
        { country: "US", visitors: 220 },
        { country: "JP", visitors: 110 },
      ],
      {
        US: [39.8, -98.6],
        CN: [35, 105],
        JP: [36.2, 138.3],
      },
    );

    expect(specs.map((spec: { country: string }) => spec.country)).toEqual(["US", "JP", "CN"]);
    expect(specs[0].radius).toBeGreaterThan(specs[1].radius);
    expect(specs[1].radius).toBeGreaterThan(specs[2].radius);
  });
});
