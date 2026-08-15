import { describe, expect, it } from "vitest";

import { deriveSourceMetadata } from "./source-metadata";

describe("deriveSourceMetadata", () => {
  it("splits a dated filename into type, date and subject", () => {
    expect(deriveSourceMetadata("delivery-reports/2025-05-bubble-bakery.md")).toEqual({
      docType: "delivery-report",
      date: "2025-05",
      subject: "bubble-bakery",
    });
  });

  it("reads a full day-precision date", () => {
    expect(deriveSourceMetadata("meeting-notes/2025-03-03-production-sync.md")).toEqual({
      docType: "meeting-note",
      date: "2025-03-03",
      subject: "production-sync",
    });
  });

  it("returns a null docType for a file at the corpus root", () => {
    expect(deriveSourceMetadata("sdk-notes-v3.md")).toEqual({
      docType: null,
      date: null,
      subject: "sdk-notes-v3",
    });
  });

  it("leaves the subject intact when the filename carries no date", () => {
    expect(deriveSourceMetadata("changelogs/lumen-build-4.2.md")).toEqual({
      docType: "changelog",
      date: null,
      subject: "lumen-build-4.2",
    });
  });

  it("does not mistake a version number for a date", () => {
    expect(deriveSourceMetadata("guides/asset-naming.md").date).toBeNull();
  });

  it("keeps the date as the subject when there is nothing else in the name", () => {
    expect(deriveSourceMetadata("meeting-notes/2025-03-03.md")).toEqual({
      docType: "meeting-note",
      date: "2025-03-03",
      subject: "2025-03-03",
    });
  });
});
