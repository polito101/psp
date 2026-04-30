import { describe, expect, it } from "vitest";
import { buildCsvDocument, sanitizeCsvCell } from "./transactions-export";

describe("sanitizeCsvCell", () => {
  it("neutralizes spreadsheet formula starters", () => {
    expect(sanitizeCsvCell("=cmd")).toBe("'=cmd");
    expect(sanitizeCsvCell(" +evil")).toBe("' +evil");
  });

  it("escapes embedded double quotes", () => {
    expect(sanitizeCsvCell('say "hi"')).toBe('say ""hi""');
  });
});

describe("buildCsvDocument", () => {
  it("joins header and rows with newlines", () => {
    expect(buildCsvDocument(["a", "b"], [["1", "2"], ["x,y", "z"]])).toBe(
      '"a","b"\n"1","2"\n"x,y","z"',
    );
  });
});
