import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  anonLabel,
  bulkTitle,
  captureOneString,
  csvCell,
  csvLine,
  fmtBa,
  fmtBaSeconds,
  namesTxt,
  stripExt,
} from "../app/lib/admin-activity";

describe("csvCell", () => {
  it("passes plain text and numbers, empty for null/undefined", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("quotes cells with comma, quote, CR or LF and doubles quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });
  it("neutralises formula injection (= + - @ tab CR) with a leading apostrophe", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe('"\'\rx"');
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(
      '"\'=HYPERLINK(""http://x"",""y"")"',
    );
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("csvLine / BOM", () => {
  it("joins with commas and ends with CRLF", () => {
    expect(csvLine(["a", "b,c", null])).toBe('a,"b,c",\r\n');
  });
  it("BOM is U+FEFF", () => {
    expect(CSV_BOM).toBe("﻿");
  });
});

describe("Buenos Aires time", () => {
  it("formats UTC as UTC-3 wall clock", () => {
    expect(fmtBa("2026-11-16T02:30:00Z")).toBe("15/11/2026 23:30");
    expect(fmtBaSeconds("2026-11-16T02:30:05Z")).toBe("2026-11-15 23:30:05");
    expect(fmtBa("garbage")).toBe("");
  });
});

describe("Capture One strings", () => {
  it("strips known image extensions only", () => {
    expect(stripExt("IMG_1.jpg")).toBe("IMG_1");
    expect(stripExt("IMG_1.JPEG")).toBe("IMG_1");
    expect(stripExt("IMG_1")).toBe("IMG_1");
    expect(stripExt("a.b")).toBe("a.b");
  });
  it("space-separated by default, comma-separated variant, deduped", () => {
    expect(captureOneString(["IMG_1", "IMG_2.jpg", "IMG_1"], "space")).toBe(
      "IMG_1 IMG_2",
    );
    expect(captureOneString(["IMG_1", "IMG_2"], "comma")).toBe("IMG_1,IMG_2");
    expect(captureOneString([], "space")).toBe("");
  });
  it("quotes names that contain whitespace", () => {
    expect(captureOneString(["a b", "c"], "space")).toBe('"a b" c');
  });
  it("txt: one per line, trailing newline, empty for none", () => {
    expect(namesTxt(["IMG_1.jpg", "IMG_2", "IMG_1"])).toBe("IMG_1\nIMG_2\n");
    expect(namesTxt([])).toBe("");
  });
});

describe("labels", () => {
  it("anonLabel uses a short id", () => {
    expect(anonLabel("abcdef12-0000")).toBe("Anónimo #abcdef");
  });
  it("bulkTitle", () => {
    expect(bulkTitle("all", 12)).toBe("Descarga completa: Todas (12 fotos)");
    expect(bulkTitle("favorites", 1)).toBe(
      "Descarga completa: Favoritos (1 foto)",
    );
    expect(bulkTitle("set:Fiesta", 0)).toBe(
      "Descarga completa: Set Fiesta (0 fotos)",
    );
    expect(bulkTitle(null, 3)).toBe("Descarga completa: sin detalle (3 fotos)");
  });
});
