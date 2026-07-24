import type { PerformanceRating } from "./contract";

export type FinalVital = {
  name: string;
  value: number;
  rating?: PerformanceRating;
  page: string;
};

export class FinalVitalAccumulator {
  private readonly values = new Map<string, FinalVital>();

  record(vital: FinalVital, strategy: "latest" | "max" = "latest") {
    const previous = this.values.get(vital.name);
    this.values.set(
      vital.name,
      strategy === "max" && previous && previous.value > vital.value ? previous : vital
    );
  }

  drain() {
    const result = [...this.values.values()];
    this.values.clear();
    return result;
  }
}

export class RouteCumulativeValue {
  private value = 0;

  add(delta: number) {
    this.value += delta;
    return this.value;
  }

  reset() {
    this.value = 0;
  }
}
