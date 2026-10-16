import { placeWhere, searchPlaces } from "./locations.service";
import { afterEach, describe, expect, it, spyOn } from "bun:test";

const contains = (value: string) => ({
  location: { contains: value, mode: "insensitive" as const },
});
const inCanada = { OR: [{ countries: { has: "CA" } }, { countries: { isEmpty: true } }] };

function postalLookup(places: { "place name": string; state: string }[]) {
  return spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ places }));
}

afterEach(() => {
  (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
});

describe("searchPlaces", () => {
  it("ranks a country above its namesake cities and big job markets first", async () => {
    expect((await searchPlaces("canada"))[0]).toEqual({ label: "Canada", kind: "country" });
    expect((await searchPlaces("toronto"))[0]).toEqual({
      label: "Toronto, Ontario, Canada",
      kind: "city",
    });
  });

  it("finds continents", async () => {
    expect((await searchPlaces("europe"))[0]).toEqual({ label: "Europe", kind: "continent" });
  });

  it("returns nothing for text that names no place", async () => {
    expect(await searchPlaces("ashaas sd")).toEqual([]);
    expect(await searchPlaces("  ")).toEqual([]);
  });

  it("resolves a US ZIP code to its city", async () => {
    const lookup = postalLookup([{ "place name": "Beverly Hills", state: "California" }]);
    expect(await searchPlaces("90210")).toEqual([
      { label: "Beverly Hills, California, United States", kind: "postal", postalCode: "90210" },
    ]);
    expect(String(lookup.mock.calls[0]?.[0])).toEndWith("/us/90210");
  });

  it("resolves a Canadian postal code by its area to the city it names", async () => {
    const lookup = postalLookup([
      { "place name": "Downtown Toronto (CN Tower / King and Spadina)", state: "Ontario" },
    ]);
    expect(await searchPlaces("m5v 2t6")).toEqual([
      { label: "Toronto, Ontario, Canada", kind: "postal", postalCode: "M5V" },
    ]);
    expect(String(lookup.mock.calls[0]?.[0])).toEndWith("/ca/M5V");
  });

  it("returns no postal match when the lookup fails", async () => {
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await searchPlaces("10001")).toEqual([]);
  });
});

describe("placeWhere", () => {
  it("matches a city by name within its country", () => {
    expect(placeWhere("Toronto, Ontario, Canada")).toEqual({
      AND: [contains("Toronto"), inCanada],
    });
  });

  it("matches a region by its name or the code postings use", () => {
    expect(placeWhere("Ontario, Canada")).toEqual({
      AND: [{ OR: [contains("Ontario"), contains(", ON")] }, inCanada],
    });
  });

  it("matches a country by its listing code or name", () => {
    expect(placeWhere("Canada")).toEqual({
      OR: [{ countries: { has: "CA" } }, contains("Canada")],
    });
  });

  it("matches a continent by the countries on it", () => {
    const where = placeWhere("North America") as { countries: { hasSome: string[] } };
    expect(where.countries.hasSome).toContain("CA");
    expect(where.countries.hasSome).toContain("US");
    expect(where.countries.hasSome).not.toContain("BR");
  });

  it("matches a plain place name by its text", () => {
    expect(placeWhere("Toronto")).toEqual(contains("Toronto"));
  });
});
