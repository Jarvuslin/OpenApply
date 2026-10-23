import { durationLabel, fromMonthInput, toMonthInput } from "./history-dates";
import { expect, test } from "bun:test";

test("counts both end months between saved dates", () => {
  expect(durationLabel("Sep 2023", "Oct 2025")).toBe("2 yrs 2 mos");
  expect(durationLabel("May 2025", "Aug 2025")).toBe("4 mos");
  expect(durationLabel("January 2024", "December 2024")).toBe("1 yr");
  expect(durationLabel("09/2023", "10/2025")).toBe("2 yrs 2 mos");
});

test("leaves the duration out when a date is not readable", () => {
  expect(durationLabel("", "Oct 2025")).toBeNull();
  expect(durationLabel("Fall term", "Oct 2025")).toBeNull();
  expect(durationLabel("Oct 2025", "Sep 2023")).toBeNull();
});

test("round-trips saved months through a month input", () => {
  expect(toMonthInput("Sep 2023")).toBe("2023-09");
  expect(toMonthInput("September 2023")).toBe("2023-09");
  expect(toMonthInput("")).toBe("");
  expect(fromMonthInput("2023-09")).toBe("Sep 2023");
});

test("keeps text that is not a single month instead of losing it", () => {
  expect(toMonthInput("Summer 2023")).toBeNull();
  expect(toMonthInput("2023")).toBeNull();
  expect(fromMonthInput(" Summer 2023 ")).toBe("Summer 2023");
});
