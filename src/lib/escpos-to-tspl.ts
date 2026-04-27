/**
 * Extract printable text from an ESC/POS byte stream.
 * Strips control sequences (ESC, GS, FS, DLE, etc.) and keeps the printable
 * UTF-8/ASCII payload — typically the drink name(s) sent by WNO POS.
 */
export function extractTextFromEscPos(bytes: Uint8Array): string {
  const ESC = 0x1b;
  const GS = 0x1d;
  const FS = 0x1c;
  const DLE = 0x10;
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];

    // ESC sequences
    if (b === ESC) {
      const cmd = bytes[i + 1];
      i += 2;
      // Commands with N data bytes
      const fixed: Record<number, number> = {
        0x21: 1, // select print mode
        0x2d: 1, // underline
        0x33: 1, // line spacing
        0x32: 0, // default line spacing
        0x40: 0, // initialize
        0x45: 1, // bold
        0x47: 1, // double-strike
        0x4d: 1, // font select
        0x52: 1, // intl charset
        0x61: 1, // alignment
        0x64: 1, // feed N lines
        0x70: 3, // pulse drawer
        0x74: 1, // codepage
        0x7b: 1, // upside down
      };
      if (cmd in fixed) i += fixed[cmd];
      else if (cmd === 0x2a) i += 2 + (bytes[i] | (bytes[i + 1] << 8)); // bit image
      else if (cmd === 0x26) {
        // user-defined chars — skip variable
        const y = bytes[i];
        const c1 = bytes[i + 1];
        const c2 = bytes[i + 2];
        i += 3;
        const count = c2 - c1 + 1;
        for (let k = 0; k < count; k++) {
          const x = bytes[i];
          i += 1 + x * y;
        }
      }
      continue;
    }

    // GS sequences
    if (b === GS) {
      const cmd = bytes[i + 1];
      i += 2;
      const fixed: Record<number, number> = {
        0x21: 1, // size
        0x42: 1, // reverse mode
        0x4c: 2, // left margin
        0x56: 1, // cut paper (also accepts 2)
        0x57: 2, // print width
        0x66: 1, // HRI font
        0x68: 1, // barcode height
        0x77: 1, // barcode width
        0x48: 1, // HRI position
      };
      if (cmd in fixed) i += fixed[cmd];
      else if (cmd === 0x6b) {
        // barcode: format1 ends at NUL; format2 has length byte
        const m = bytes[i];
        if (m <= 6) {
          i += 1;
          while (i < bytes.length && bytes[i] !== 0) i++;
          i++;
        } else {
          const n = bytes[i + 1];
          i += 2 + n;
        }
      } else if (cmd === 0x76) {
        // raster bit image: 0x30 m xL xH yL yH data
        i += 1; // m
        const xL = bytes[i],
          xH = bytes[i + 1],
          yL = bytes[i + 2],
          yH = bytes[i + 3];
        i += 4;
        const w = xL | (xH << 8);
        const h = yL | (yH << 8);
        i += w * h;
      } else if (cmd === 0x28) {
        // GS ( fn pL pH ...
        i += 1; // fn
        const pL = bytes[i];
        const pH = bytes[i + 1];
        i += 2 + (pL | (pH << 8));
      }
      continue;
    }

    // FS sequences (kanji, etc.)
    if (b === FS) {
      const cmd = bytes[i + 1];
      i += 2;
      const fixed: Record<number, number> = {
        0x21: 1,
        0x26: 0,
        0x2d: 1,
        0x2e: 0,
        0x43: 1,
        0x53: 2,
        0x57: 1,
      };
      if (cmd in fixed) i += fixed[cmd];
      continue;
    }

    if (b === DLE) {
      // DLE EOT n — real-time status
      i += 3;
      continue;
    }

    // Skip other low control bytes except LF (newline) and tab
    if (b < 0x20 && b !== 0x0a && b !== 0x09) {
      i += 1;
      continue;
    }

    out.push(b);
    i += 1;
  }

  // Decode as UTF-8 (fallback to latin1 if invalid)
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(out));
  } catch {
    return String.fromCharCode(...out);
  }
}

/**
 * Take raw extracted ESC/POS text and split into individual sticker lines.
 * Each non-empty line becomes one sticker.
 */
export function textToStickerLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

export interface TsplOptions {
  /** Label width in mm (default 40). */
  widthMm?: number;
  /** Label height in mm (default 30). */
  heightMm?: number;
  /** Gap between labels in mm (default 3). */
  gapMm?: number;
  /** Print speed (default 4). */
  speed?: number;
  /** Print density 0-15 (default 8). */
  density?: number;
  /** Copies (default 1). */
  copies?: number;
}

/**
 * Build a TSPL command stream that prints ONE sticker per drink name,
 * centered, with auto-shrinking font for long names. Uses GAP sensor.
 */
export function buildTsplStickers(
  lines: string[],
  opts: TsplOptions = {},
): string {
  const w = opts.widthMm ?? 40;
  const h = opts.heightMm ?? 30;
  const gap = opts.gapMm ?? 3;
  const speed = opts.speed ?? 4;
  const density = opts.density ?? 8;
  const copies = opts.copies ?? 1;

  // 203 dpi → 8 dots/mm
  const dotsPerMm = 8;
  const widthDots = w * dotsPerMm;
  const heightDots = h * dotsPerMm;

  const header = [
    `SIZE ${w} mm,${h} mm`,
    `GAP ${gap} mm,0 mm`,
    `DIRECTION 1`,
    `REFERENCE 0,0`,
    `SPEED ${speed}`,
    `DENSITY ${density}`,
    `CLS`,
  ];

  const out: string[] = [];

  for (const raw of lines) {
    const name = raw.trim();
    if (!name) continue;

    // Pick TSS24.BF2 scalable font; choose multiplier based on length.
    // TSS24 base is ~24px tall. We size up for short names.
    let mul = 3; // 3x → ~72px tall
    if (name.length > 10) mul = 2;
    if (name.length > 18) mul = 1;
    const charWidthApprox = 12 * mul; // rough px per char for centering
    const textPxWidth = Math.min(widthDots - 8, name.length * charWidthApprox);
    const x = Math.max(4, Math.floor((widthDots - textPxWidth) / 2));
    const y = Math.max(8, Math.floor((heightDots - 24 * mul) / 2));

    out.push(...header);
    // TEXT x,y,"font",rotation,x-mul,y-mul,"content"
    const safe = name.replace(/"/g, "'");
    out.push(`TEXT ${x},${y},"TSS24.BF2",0,${mul},${mul},"${safe}"`);
    out.push(`PRINT ${copies},1`);
  }

  return out.join("\r\n") + "\r\n";
}

/** Convenience: ESC/POS bytes → TSPL string. */
export function escPosToTspl(bytes: Uint8Array, opts: TsplOptions = {}): string {
  const text = extractTextFromEscPos(bytes);
  const lines = textToStickerLines(text);
  return buildTsplStickers(lines, opts);
}
