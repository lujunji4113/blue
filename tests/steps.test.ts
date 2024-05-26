import { describe, expect, it } from "vitest";
import { steps } from "../src/utils";

describe("steps()", () => {
  it("works", () => {
    const received = Array.from(steps(1, 2));
    expect(received).toStrictEqual([[1, 2]]);
  });

  it("works when step is 3", () => {
    const received = Array.from(steps(2, 7, 3));
    expect(received).toStrictEqual([
      [2, 5],
      [5, 7],
    ]);
  });

  it("works when step is 4", () => {
    const received = Array.from(steps(2, 10, 4));
    expect(received).toStrictEqual([
      [2, 6],
      [6, 10],
    ]);
  });

  it("works when direction is reverse", () => {
    const received = Array.from(steps(1, 10, 4, { reverse: true }));
    expect(received).toStrictEqual([
      [6, 10],
      [2, 6],
      [1, 2],
    ]);
  });
});
