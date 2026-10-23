import { boardBelongsTo, boardSlugs, ycHiringCompanies } from "./yc-companies";
import { expect, it } from "bun:test";

const phoenix = { name: "Phoenix", slug: "phoenix", website: "https://www.phoenix.ca" };

it("reads hiring YC companies once per slug and skips malformed rows", async () => {
  const companies = await ycHiringCompanies(async (url) => {
    expect(url).toBe("https://yc-oss.github.io/api/companies/hiring.json");
    return [phoenix, { ...phoenix, name: "Phoenix duplicate" }, { name: "", slug: "x" }];
  });
  expect(companies).toEqual([phoenix]);
  await expect(ycHiringCompanies(async () => ({}))).rejects.toThrow();
});

it("guesses the YC slug first, then the name with only letters and digits", () => {
  expect(boardSlugs({ name: "10x Science", slug: "10x-science" })).toEqual([
    "10x-science",
    "10xscience",
  ]);
  expect(boardSlugs({ name: "Rescale", slug: "rescale" })).toEqual(["rescale"]);
  expect(boardSlugs({ name: "PNOĒ", slug: "p" })).toEqual(["pno"]);
});

it("keeps a guessed board only when its postings name the company or its domain", () => {
  expect(boardBelongsTo(phoenix, ["Senior Engineer\nApply at phoenix.ca today."])).toBe(true);
  expect(boardBelongsTo(phoenix, ["ABOUT PHOENIX: Canada's telehealth clinic."])).toBe(true);
  expect(boardBelongsTo(phoenix, ["We are Phoenixville Bank, hiring tellers."])).toBe(false);
  expect(boardBelongsTo(phoenix, ["Acme builds rockets."])).toBe(false);
});
