import { describe, expect, it } from "vitest";
import {
  buildTsplStickers,
  escPosToTspl,
  extractTextFromEscPos,
  textToStickerLines,
} from "@/lib/escpos-to-tspl";

const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("extractTextFromEscPos", () => {
  it("strips ESC @ initialize and keeps text", () => {
    const bytes = concat(new Uint8Array([0x1b, 0x40]), enc("Latte\n"));
    expect(extractTextFromEscPos(bytes)).toBe("Latte\n");
  });

  it("strips alignment, bold, size selectors", () => {
    const bytes = concat(
      new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x21, 0x11, 0x1b, 0x45, 0x01]),
      enc("Cappuccino\n"),
      new Uint8Array([0x1b, 0x45, 0x00, 0x1d, 0x56, 0x00]),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Cappuccino");
  });

  it("handles multiple drinks separated by line feeds", () => {
    const bytes = concat(
      new Uint8Array([0x1b, 0x40]),
      enc("Iced Latte\nFlat White\nMocha\n"),
      new Uint8Array([0x1d, 0x56, 0x42, 0x00]),
    );
    const lines = textToStickerLines(extractTextFromEscPos(bytes));
    expect(lines).toEqual(["Iced Latte", "Flat White", "Mocha"]);
  });
});

describe("buildTsplStickers", () => {
  it("emits SIZE, GAP and one PRINT per line", () => {
    const tspl = buildTsplStickers(["Latte", "Mocha"]);
    expect(tspl).toMatch(/SIZE 40 mm,30 mm/);
    expect(tspl).toMatch(/GAP 3 mm,0 mm/);
    expect((tspl.match(/PRINT 1,1/g) || []).length).toBe(2);
    expect(tspl).toContain('"Latte"');
    expect(tspl).toContain('"Mocha"');
  });

  it("escapes quotes in drink names", () => {
    const tspl = buildTsplStickers(['"Special"']);
    expect(tspl).toContain("\"'Special'\"");
  });
});

describe("escPosToTspl integration", () => {
  it("converts realistic POS print job", () => {
    const bytes = concat(
      new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x21, 0x11]),
      enc("Caramel Macchiato\n"),
      new Uint8Array([0x1d, 0x56, 0x42, 0x00]),
    );
    const tspl = escPosToTspl(bytes);
    expect(tspl).toContain('"Caramel Macchiato"');
    expect(tspl).toContain("PRINT 1,1");
  });
});
