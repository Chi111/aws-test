import { describe, expect, it } from "vitest";
import { FinalVitalAccumulator, RouteCumulativeValue } from "./vitals";

describe("final Web Vital accumulation", () => {
  it("emits one final sample per metric and keeps the maximum interaction latency", () => {
    const accumulator = new FinalVitalAccumulator();
    accumulator.record({ name: "LCP", value: 1200, page: "/" });
    accumulator.record({ name: "LCP", value: 2200, page: "/" });
    accumulator.record({ name: "CLS", value: 0.04, page: "/" });
    accumulator.record({ name: "CLS", value: 0.08, page: "/" });
    accumulator.record({ name: "INP", value: 300, page: "/" }, "max");
    accumulator.record({ name: "INP", value: 120, page: "/" }, "max");

    expect(accumulator.drain()).toEqual([
      { name: "LCP", value: 2200, page: "/" },
      { name: "CLS", value: 0.08, page: "/" },
      { name: "INP", value: 300, page: "/" }
    ]);
    expect(accumulator.drain()).toEqual([]);
  });

  it("resets cumulative layout shift between SPA routes", () => {
    const cls = new RouteCumulativeValue();

    expect(cls.add(0.1)).toBe(0.1);
    cls.reset();
    expect(cls.add(0.02)).toBe(0.02);
  });
});
