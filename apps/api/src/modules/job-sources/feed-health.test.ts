import { refreshAlert } from "./feed-health";
import { expect, it } from "bun:test";

it("alerts when a board that had jobs lists none, or loses more than half at once", () => {
  expect(refreshAlert(120, 0)).toBe("empty");
  expect(refreshAlert(120, 59)).toBe("dropped");
  expect(refreshAlert(120, 60)).toBeNull();
  expect(refreshAlert(120, 300)).toBeNull();
});

it("never alerts on a first refresh or a board that was already empty", () => {
  expect(refreshAlert(null, 0)).toBeNull();
  expect(refreshAlert(0, 0)).toBeNull();
});
