import { describe, expect, it } from "vitest";

import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("starts at 00:00 and pads both fields", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(9)).toBe("00:09");
    expect(formatElapsed(59)).toBe("00:59");
  });

  it("rolls over to minutes and keeps counting past the ten minute limit", () => {
    expect(formatElapsed(60)).toBe("01:00");
    expect(formatElapsed(135)).toBe("02:15");
    expect(formatElapsed(600)).toBe("10:00");
    expect(formatElapsed(3601)).toBe("60:01");
  });

  it("never renders a negative or fractional clock", () => {
    expect(formatElapsed(-5)).toBe("00:00");
    expect(formatElapsed(12.9)).toBe("00:12");
  });
});
