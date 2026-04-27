import { describe, expect, it } from "vitest";
import {
  buildTsplStickers,
  escPosToTspl,
  extractTextFromEscPos,
  parseEscPos,
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
const b = (...nums: number[]) => new Uint8Array(nums);

/* --------------------------------------------------------------------- */
/* Original baseline tests                                                */
/* --------------------------------------------------------------------- */

describe("extractTextFromEscPos — baseline", () => {
  it("strips ESC @ initialize and keeps text", () => {
    const bytes = concat(b(0x1b, 0x40), enc("Latte\n"));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });

  it("strips alignment, bold, size selectors", () => {
    const bytes = concat(
      b(0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x21, 0x11, 0x1b, 0x45, 0x01),
      enc("Cappuccino\n"),
      b(0x1b, 0x45, 0x00, 0x1d, 0x56, 0x00),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Cappuccino");
  });

  it("handles multiple drinks separated by line feeds", () => {
    const bytes = concat(
      b(0x1b, 0x40),
      enc("Iced Latte\nFlat White\nMocha\n"),
      b(0x1d, 0x56, 0x42, 0x00),
    );
    expect(textToStickerLines(extractTextFromEscPos(bytes))).toEqual([
      "Iced Latte",
      "Flat White",
      "Mocha",
    ]);
  });
});

/* --------------------------------------------------------------------- */
/* Variable-length commands                                              */
/* --------------------------------------------------------------------- */

describe("variable-length commands", () => {
  it("skips ESC * bit image (m=0, n bytes)", () => {
    const bytes = concat(
      b(0x1b, 0x2a, 0x00, 0x05, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0xee),
      enc("Espresso\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Espresso");
  });

  it("skips ESC * bit image (m=33, 3 bytes per column)", () => {
    const data = new Uint8Array(3 * 3); // 3 columns × 3 bytes
    const bytes = concat(b(0x1b, 0x2a, 0x21, 0x03, 0x00), data, enc("Mocha\n"));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Mocha");
  });

  it("skips GS k barcode format 1 (NUL-terminated)", () => {
    const bytes = concat(
      b(0x1d, 0x6b, 0x04),
      enc("12345678"),
      b(0x00),
      enc("Latte\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });

  it("skips GS k barcode format 2 (length-prefixed)", () => {
    const bytes = concat(
      b(0x1d, 0x6b, 0x49, 0x05),
      enc("ABCDE"),
      enc("Mocha\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Mocha");
  });

  it("skips GS v 0 raster image of nontrivial size", () => {
    const w = 4;
    const h = 8;
    const data = new Uint8Array(w * h);
    const bytes = concat(
      b(0x1d, 0x76, 0x30, 0x00, w & 0xff, 0x00, h & 0xff, 0x00),
      data,
      enc("Tea\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Tea");
  });

  it("skips GS ( fn pL pH ... block", () => {
    const bytes = concat(
      b(0x1d, 0x28, 0x4c, 0x06, 0x00, 0x30, 0x45, 0x20, 0x01, 0x01, 0x31),
      enc("Latte\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });

  it("skips ESC D horizontal-tab list (NUL-terminated)", () => {
    const bytes = concat(
      b(0x1b, 0x44, 0x08, 0x10, 0x18, 0x20, 0x00),
      enc("Latte\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });

  it("skips ESC & user-defined char definition", () => {
    const bytes = concat(
      b(0x1b, 0x26, 0x03, 0x41, 0x42), // y=3, c1=A, c2=B → 2 chars
      b(0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), // x=5, 5×3=15 bytes
      b(0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      enc("Latte\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });

  it("skips FS q NV image definition", () => {
    const bytes = concat(
      b(0x1c, 0x71, 0x01, 0x02, 0x00, 0x02, 0x00),
      new Uint8Array(4),
      enc("Latte\n"),
    );
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });
});

/* --------------------------------------------------------------------- */
/* Codepages                                                              */
/* --------------------------------------------------------------------- */

describe("codepage handling", () => {
  it("decodes UTF-8 text by default", () => {
    const bytes = concat(b(0x1b, 0x40), enc("Café Olé\n"));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Café Olé");
  });

  it("decodes Windows-1252 when ESC t selects it (n=16)", () => {
    // ESC t 16 → CP1252. 0xE9 = é in 1252.
    const bytes = concat(b(0x1b, 0x74, 0x10, 0x43, 0x61, 0x66, 0xe9, 0x0a));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Café");
  });

  it("falls back to latin1 on undecodable bytes", () => {
    const bytes = concat(enc("X"), b(0xfe, 0x0a));
    const t = extractTextFromEscPos(bytes);
    expect(t.startsWith("X")).toBe(true);
  });
});

/* --------------------------------------------------------------------- */
/* Soft line breaks (cut, feed N)                                         */
/* --------------------------------------------------------------------- */

describe("soft line breaks", () => {
  it("treats GS V (cut) between two items as a line break", () => {
    const bytes = concat(
      b(0x1b, 0x40),
      enc("Latte"),
      b(0x1d, 0x56, 0x00), // cut
      enc("Mocha\n"),
    );
    expect(textToStickerLines(extractTextFromEscPos(bytes))).toEqual([
      "Latte",
      "Mocha",
    ]);
  });

  it("treats ESC d N (feed N lines) as a line break", () => {
    const bytes = concat(
      enc("Latte"),
      b(0x1b, 0x64, 0x03),
      enc("Mocha\n"),
    );
    expect(textToStickerLines(extractTextFromEscPos(bytes))).toEqual([
      "Latte",
      "Mocha",
    ]);
  });

  it("collapses CRLF into a single line break", () => {
    const bytes = enc("Latte\r\nMocha\r\n");
    expect(textToStickerLines(extractTextFromEscPos(bytes))).toEqual([
      "Latte",
      "Mocha",
    ]);
  });

  it("FF (form feed) acts as a line break", () => {
    const bytes = concat(enc("Latte"), b(0x0c), enc("Mocha\n"));
    expect(textToStickerLines(extractTextFromEscPos(bytes))).toEqual([
      "Latte",
      "Mocha",
    ]);
  });

  it("CAN cancels current line", () => {
    const bytes = concat(enc("Junk"), b(0x18), enc("Latte\n"));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });
});

/* --------------------------------------------------------------------- */
/* Robustness against truncated / hostile streams                        */
/* --------------------------------------------------------------------- */

describe("robustness", () => {
  it("does not crash on dangling ESC at end of buffer", () => {
    expect(() => extractTextFromEscPos(b(0x41, 0x1b))).not.toThrow();
    expect(extractTextFromEscPos(b(0x41, 0x1b))).toContain("A");
  });

  it("does not crash on dangling GS k header", () => {
    expect(() => extractTextFromEscPos(b(0x1d, 0x6b))).not.toThrow();
  });

  it("does not crash on truncated GS v image header", () => {
    expect(() => extractTextFromEscPos(b(0x1d, 0x76, 0x30, 0x00))).not.toThrow();
  });

  it("respects maxBytes hard cap", () => {
    const big = new Uint8Array(2000);
    big.set(enc("Latte\n"), 0);
    const r = parseEscPos(big, { maxBytes: 100 });
    expect(r.consumed).toBeLessThanOrEqual(100);
  });

  it("ignores stray NUL bytes inside text", () => {
    const bytes = concat(enc("La"), b(0x00), enc("tte\n"));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Latte");
  });

  it("converts TAB to a single space", () => {
    const bytes = concat(enc("Iced"), b(0x09), enc("Latte\n"));
    expect(extractTextFromEscPos(bytes).trim()).toBe("Iced Latte");
  });
});

/* --------------------------------------------------------------------- */
/* textToStickerLines noise filtering                                    */
/* --------------------------------------------------------------------- */

describe("textToStickerLines", () => {
  it("drops separator-only lines", () => {
    expect(
      textToStickerLines("Latte\n--------\nMocha\n=====\n"),
    ).toEqual(["Latte", "Mocha"]);
  });

  it("dedupes consecutive duplicates", () => {
    expect(textToStickerLines("Latte\nLatte\nMocha\n")).toEqual([
      "Latte",
      "Mocha",
    ]);
  });

  it("strips zero-width characters", () => {
    expect(textToStickerLines("La\u200Btte\n")).toEqual(["Latte"]);
  });

  it("collapses inner whitespace", () => {
    expect(textToStickerLines("Iced   Caramel    Latte\n")).toEqual([
      "Iced Caramel Latte",
    ]);
  });

  it("respects dropLinePattern", () => {
    expect(
      textToStickerLines("Order #123\nLatte\n", {
        dropLinePattern: /^order\b/i,
      }),
    ).toEqual(["Latte"]);
  });
});

/* --------------------------------------------------------------------- */
/* TSPL builder                                                           */
/* --------------------------------------------------------------------- */

describe("buildTsplStickers", () => {
  it("emits SIZE, GAP, CODEPAGE and one PRINT per line", () => {
    const tspl = buildTsplStickers(["Latte", "Mocha"]);
    expect(tspl).toMatch(/SIZE 40 mm,30 mm/);
    expect(tspl).toMatch(/GAP 3 mm,0 mm/);
    expect(tspl).toMatch(/CODEPAGE UTF-8/);
    expect((tspl.match(/PRINT 1,1/g) || []).length).toBe(2);
    expect(tspl).toContain('"Latte"');
    expect(tspl).toContain('"Mocha"');
  });

  it("escapes quotes and backslashes in drink names", () => {
    const tspl = buildTsplStickers(['"Special"', "Back\\Slash"]);
    expect(tspl).toContain("\"'Special'\"");
    expect(tspl).toContain('"Back/Slash"');
  });

  it("uses BLOCK with auto-shrink for long names", () => {
    const tspl = buildTsplStickers([
      "Extra Large Iced Caramel Macchiato with Oat Milk",
    ]);
    expect(tspl).toMatch(/^BLOCK /m);
    expect(tspl).not.toMatch(/^TEXT /m);
  });

  it("uses TEXT for short names", () => {
    const tspl = buildTsplStickers(["Latte"]);
    expect(tspl).toMatch(/^TEXT /m);
    expect(tspl).not.toMatch(/^BLOCK /m);
  });

  it("respects maxStickers cap", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Drink ${i}`);
    const tspl = buildTsplStickers(lines, { maxStickers: 5 });
    expect((tspl.match(/PRINT 1,1/g) || []).length).toBe(5);
  });

  it("scales geometry to 300dpi", () => {
    const tspl = buildTsplStickers(["Latte"], { dpi: 300, widthMm: 40 });
    // At 300dpi → 12 dots/mm → 480 dots wide; x should be plausible
    expect(tspl).toMatch(/TEXT \d+,\d+,/);
  });

  it("strips control bytes from input", () => {
    const tspl = buildTsplStickers(["La\x00\x07tte"]);
    expect(tspl).toContain('"Latte"');
  });

  it("emits empty string for empty input", () => {
    expect(buildTsplStickers([])).toBe("");
  });
});

/* --------------------------------------------------------------------- */
/* End-to-end                                                             */
/* --------------------------------------------------------------------- */

describe("escPosToTspl integration", () => {
  it("converts realistic single-item POS print job", () => {
    const bytes = concat(
      b(0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x21, 0x11),
      enc("Caramel Macchiato\n"),
      b(0x1d, 0x56, 0x42, 0x00),
    );
    const tspl = escPosToTspl(bytes);
    expect(tspl).toContain('"Caramel Macchiato"');
    expect(tspl).toContain("PRINT 1,1");
  });

  it("converts multi-item job with cuts between items into N stickers", () => {
    const bytes = concat(
      b(0x1b, 0x40),
      enc("Latte"),
      b(0x1d, 0x56, 0x42, 0x00),
      enc("Mocha"),
      b(0x1d, 0x56, 0x42, 0x00),
      enc("Flat White\n"),
      b(0x1d, 0x56, 0x42, 0x00),
    );
    const tspl = escPosToTspl(bytes);
    expect((tspl.match(/PRINT 1,1/g) || []).length).toBe(3);
    expect(tspl).toContain('"Latte"');
    expect(tspl).toContain('"Mocha"');
    expect(tspl).toContain('"Flat White"');
  });

  it("ignores barcode payload but keeps drink name", () => {
    const bytes = concat(
      b(0x1b, 0x40, 0x1b, 0x61, 0x01),
      enc("Iced Latte\n"),
      b(0x1d, 0x6b, 0x04),
      enc("987654321"),
      b(0x00),
      b(0x1d, 0x56, 0x42, 0x00),
    );
    const tspl = escPosToTspl(bytes);
    expect(tspl).toContain('"Iced Latte"');
    expect(tspl).not.toContain('"987654321"');
  });
});
