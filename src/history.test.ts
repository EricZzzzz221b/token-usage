import { describe, expect, it } from "vitest";
import { buildHistoryPath } from "./history";

describe("buildHistoryPath", () => {
  it("maps remaining percentage to a fixed zero-to-one-hundred chart", () => {
    const path = buildHistoryPath(
      [
        { queriedAt: 0, remainingPercent: 100 },
        { queriedAt: 10, remainingPercent: 50 },
        { queriedAt: 20, remainingPercent: 0 },
      ],
      100,
      100,
      10,
    );

    expect(path).toBe("M10.00,10.00 L50.00,50.00 L90.00,90.00");
  });

  it("clamps values outside the supported range", () => {
    expect(
      buildHistoryPath(
        [
          { queriedAt: 0, remainingPercent: 120 },
          { queriedAt: 1, remainingPercent: -5 },
        ],
        20,
        20,
        0,
      ),
    ).toBe("M0.00,0.00 L20.00,20.00");
  });
});
