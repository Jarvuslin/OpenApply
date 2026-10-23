import { summarizeDiscoverySources } from "./discovery-source-summary";
import { expect, it } from "bun:test";

it("groups repeated source requests without dropping counts or implying unique results", () => {
  const first = {
    source: "employer.example",
    fetched: 5,
    saved: 4,
    resolved: 5,
    requests: 1,
    truncated: true,
    checkedAt: "2026-10-07T12:00:00.000Z",
  };
  const second = {
    ...first,
    fetched: 3,
    saved: 1,
    resolved: 2,
    truncated: false,
    checkedAt: "2026-10-07T12:01:00.000Z",
  };
  const other = { ...second, source: "other.example" };
  const summaries = summarizeDiscoverySources([second, other, first]);
  expect(summaries).toEqual([
    {
      source: first.source,
      fetched: 8,
      saved: 5,
      resolved: 7,
      requests: 2,
      truncated: true,
      checkedAt: second.checkedAt,
    },
    other,
  ]);
  expect(second.fetched).toBe(3);
  expect(first.saved).toBe(4);
});

it("handles requests sharing a source and timestamp and an empty coverage report", () => {
  const source = {
    source: "employer.example",
    fetched: 1,
    saved: 0,
    resolved: 0,
    requests: 1,
    truncated: false,
    checkedAt: "2026-10-07T12:00:00.000Z",
  };
  expect(summarizeDiscoverySources([source, source])).toEqual([
    { ...source, fetched: 2, requests: 2 },
  ]);
  expect(summarizeDiscoverySources([])).toEqual([]);
});
