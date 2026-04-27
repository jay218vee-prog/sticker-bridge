/* =========================================================================
 * ESC/POS  →  TSPL converter
 * -------------------------------------------------------------------------
 * Used as the canonical, unit-tested reference. The Kotlin port in
 * native-android/app/src/main/java/com/stickerbridge/convert/ mirrors the
 * exact same behaviour.
 *
 * Supports:
 *   - Epson/Star ESC/POS command stripping with proper variable-length
 *     handling (GS k barcodes, GS v raster, GS ( fn pL pH ..., GS / image,
 *     ESC * bit image, ESC & user chars, FS p NV image, FS q NV define).
 *   - Codepage-aware text decoding (ESC t n). Defaults to CP437; supports
 *     437, 850, 852, 858, 860, 863, 865, 866, 874, 1252, ISO-8859-1/2/15
 *     and UTF-8 (auto-detected).
 *   - Treats LF, CR, FF, ESC J/d (feed N), GS V (cut) as line separators
 *     so multi-item jobs split into multiple stickers even if the POS only
 *     emits feed/cut between them.
 *   - Filters obvious noise (separator lines, control whitespace,
 *     zero-width characters).
 *   - TSPL output uses GAP sensor mode, BLOCK for long names (auto-wrap),
 *     TEXT for short names, with safe quoting.
 * ========================================================================= */

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const DLE = 0x10;
const LF = 0x0a;
const CR = 0x0d;
const FF = 0x0c;
const HT = 0x09;
const CAN = 0x18;
const NUL = 0x00;

/** Sentinel byte we inject into the printable stream as a "soft line break"
 *  for non-textual separators (cuts, feed N lines). Not present in any
 *  real codepage so it is safe. We replace it with \n before decoding. */
const LINE_BREAK_SENTINEL = 0xff;

export interface ParseOptions {
  /** Default codepage if the POS never sends ESC t. Default 437. */
  defaultCodepage?: number;
  /** Hard cap on bytes accepted per job (defends against runaway streams). */
  maxBytes?: number;
  /** If true, drop lines that look like separators / receipt chrome. */
  filterReceiptNoise?: boolean;
  /** Optional regex of lines to drop entirely (case-insensitive). */
  dropLinePattern?: RegExp;
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
  /** Printer DPI; OC8600 is 203 DPI (8 dots/mm). */
  dpi?: 203 | 300;
  /** Hard cap on stickers emitted per job. Default 50. */
  maxStickers?: number;
}

/* -------------------------------------------------------------------------
 * Command tables — bytes to skip AFTER the (ESC|GS|FS) + cmd byte pair.
 * Numbers from the Epson TM-T88 / TM-U220 / Star MC-Print command refs.
 * ------------------------------------------------------------------------- */

const ESC_FIXED: Record<number, number> = {
  0x20: 1, // ESC SP n        right-side char spacing
  0x21: 1, // ESC ! n         select print mode
  0x24: 2, // ESC $ nL nH     absolute horizontal pos
  0x25: 1, // ESC % n         user-defined char set on/off
  0x2d: 1, // ESC - n         underline
  0x32: 0, // ESC 2           default line spacing
  0x33: 1, // ESC 3 n         set line spacing
  0x3d: 1, // ESC = n         peripheral select
  0x3f: 1, // ESC ? n         cancel user-defined char
  0x40: 0, // ESC @           initialize
  0x44: -1, // ESC D n1..nk NUL  horizontal tab stops (terminated by NUL)
  0x45: 1, // ESC E n         bold
  0x46: 1, // ESC F n         (some) double-strike off
  0x47: 1, // ESC G n         double-strike
  0x48: 1, // ESC H n         (Star) some
  0x49: 1, // ESC I n         (Star)
  0x4a: 1, // ESC J n         feed N units
  0x4b: 1, // ESC K n         reverse feed N units (Star)
  0x4c: 0, // ESC L           page mode
  0x4d: 1, // ESC M n         font select
  0x52: 1, // ESC R n         intl charset
  0x53: 0, // ESC S           standard mode
  0x54: 1, // ESC T n         page mode print direction
  0x56: 1, // ESC V n         rotate 90
  0x57: 8, // ESC W ...       set print area (xL xH yL yH dxL dxH dyL dyH)
  0x5c: 2, // ESC \ nL nH     relative print position
  0x61: 1, // ESC a n         alignment
  0x62: 1, // ESC b n         (Star) buzzer
  0x63: 2, // ESC c n m       panel button (varies; safe to skip 2)
  0x64: 1, // ESC d n         feed N lines
  0x65: 1, // ESC e n         reverse feed N lines (Star)
  0x66: 2, // ESC f n m       (some)
  0x67: 1, // ESC g n         (rare)
  0x69: 0, // ESC i           full cut (Star)
  0x6d: 0, // ESC m           partial cut (Star)
  0x70: 3, // ESC p m t1 t2   pulse drawer
  0x72: 1, // ESC r n         color
  0x74: 1, // ESC t n         codepage select
  0x76: 0, // ESC v           transmit paper sensor status
  0x7b: 1, // ESC { n         upside-down
};

const GS_FIXED: Record<number, number> = {
  0x21: 1, // GS ! n          char size
  0x24: 2, // GS $ nL nH      vertical absolute pos (page mode)
  0x2a: 2, // GS * x y ...    download bit image (handled specially below)
  0x2f: 1, // GS / m          print downloaded bit image
  0x3a: 0, // GS :            start macro definition
  0x42: 1, // GS B n          reverse white/black
  0x43: 0, // GS C            (counter mode varies)
  0x45: 1, // GS E n          (some) print position
  0x48: 1, // GS H n          HRI position
  0x49: 1, // GS I n          transmit printer ID
  0x4c: 2, // GS L nL nH      left margin
  0x50: 2, // GS P x y        set basic calc unit
  0x54: 1, // GS T n          (Star) move to print start position
  0x56: -2, // GS V m [n]     paper cut: m=0/1 single byte; m=65/66 needs 1 more
  0x57: 2, // GS W nL nH      print area width
  0x5c: 2, // GS \ nL nH      vertical relative pos (page mode)
  0x61: 1, // GS a n          enable ASB
  0x62: 1, // GS b n          smoothing
  0x66: 1, // GS f n          HRI font
  0x67: 0, // GS g 0..        memory clear (varies)
  0x68: 1, // GS h n          barcode height
  0x6a: 1, // GS j n          (Star)
  0x72: 1, // GS r n          status request
  0x77: 1, // GS w n          barcode width
  0x7a: 1, // GS z n          (rare)
};

const FS_FIXED: Record<number, number> = {
  0x21: 1, // FS ! n          kanji char mode
  0x26: 0, // FS &            kanji mode on
  0x2d: 1, // FS - n          kanji underline
  0x2e: 0, // FS .            kanji mode off
  0x32: 4, // FS 2 c1 c2 d1...  define kanji (variable; conservative skip)
  0x43: 1, // FS C n          kanji code system
  0x53: 2, // FS S n1 n2      kanji char spacing
  0x57: 1, // FS W n          kanji 4x size
};

/* -------------------------------------------------------------------------
 * Codepage decoder
 * ------------------------------------------------------------------------- */

// ESC t n  →  codepage number. Most common Epson mappings.
const ESC_T_TO_CP: Record<number, number> = {
  0: 437, 1: 850, 2: 860, 3: 863, 4: 865, 5: 852, 6: 866, 7: 855, 8: 857,
  9: 862, 10: 864, 11: 869, 13: 864, 14: 1252, 15: 858, 16: 1252, 17: 1252,
  18: 852, 19: 858, 20: 874, 21: 1252, 32: 1252, 33: 1252, 34: 1252,
  35: 1252, 36: 1252, 37: 1252, 38: 1252, 39: 1252, 40: 1252, 41: 1252,
  42: 1252, 43: 1252, 44: 1252, 45: 1252, 46: 1252, 47: 1252, 48: 1252,
};

// Iconv-style label expected by TextDecoder. Browsers/Node don't ship every
// codepage; we fall back to CP1252 for any we can't decode.
const CP_TO_LABEL: Record<number, string> = {
  437: "ibm437",
  850: "ibm850",
  852: "ibm852",
  855: "ibm855",
  857: "ibm857",
  858: "ibm858",
  860: "ibm860",
  862: "ibm862",
  863: "ibm863",
  864: "ibm864",
  865: "ibm865",
  866: "ibm866",
  869: "ibm869",
  874: "windows-874",
  1252: "windows-1252",
};

function decodeWithCodepage(bytes: Uint8Array, cp: number): string {
  // 1. UTF-8 fast path: if every byte is valid UTF-8, prefer it (most modern
  //    Android POS apps emit UTF-8 regardless of the codepage they declare).
  if (isLikelyUtf8(bytes)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      /* fall through */
    }
  }
  // 2. Try the declared codepage.
  const label = CP_TO_LABEL[cp] ?? "windows-1252";
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    // 3. Last resort: latin1 byte-for-byte.
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

function isLikelyUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  let multi = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { i++; continue; }
    let need: number;
    if ((b & 0xe0) === 0xc0) need = 1;
    else if ((b & 0xf0) === 0xe0) need = 2;
    else if ((b & 0xf8) === 0xf0) need = 3;
    else return false;
    if (i + need >= bytes.length) return false;
    for (let k = 1; k <= need; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) return false;
    }
    multi++;
    i += 1 + need;
  }
  return multi > 0; // pure-ASCII isn't "UTF-8 specifically"; let the codepage path handle it
}

/* -------------------------------------------------------------------------
 * Main parser
 * ------------------------------------------------------------------------- */

interface ParseResult {
  text: string;
  /** Codepage actually used for decoding (after any ESC t). */
  codepage: number;
  /** Bytes read (may be less than input.length on overflow). */
  consumed: number;
}

/** Low-level: consume an ESC/POS stream and return decoded printable text
 *  with line-break sentinels collapsed into '\n'. */
export function parseEscPos(
  bytes: Uint8Array,
  opts: ParseOptions = {},
): ParseResult {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const limit = Math.min(bytes.length, maxBytes);
  let cp = opts.defaultCodepage ?? 437;

  const out: number[] = [];
  let i = 0;

  const skip = (n: number) => {
    if (n < 0) return;
    i += n;
    if (i > limit) i = limit;
  };

  while (i < limit) {
    const b = bytes[i];

    // --- explicit line breaks ---
    if (b === LF || b === FF || b === CR) {
      out.push(LINE_BREAK_SENTINEL);
      i++;
      // CRLF → single break
      if (b === CR && i < limit && bytes[i] === LF) i++;
      continue;
    }
    if (b === HT) {
      out.push(0x20); // tab → space
      i++;
      continue;
    }
    if (b === CAN) {
      // Cancel data in page mode — discard accumulated until next break
      while (out.length && out[out.length - 1] !== LINE_BREAK_SENTINEL) out.pop();
      i++;
      continue;
    }
    if (b === NUL) {
      i++;
      continue;
    }

    // --- ESC ---
    if (b === ESC) {
      if (i + 1 >= limit) { i = limit; break; }
      const cmd = bytes[i + 1];
      i += 2;

      // Dynamic-length first
      if (cmd === 0x2a) { // ESC * m nL nH d1...
        if (i + 3 > limit) { i = limit; break; }
        const m = bytes[i];
        const nL = bytes[i + 1];
        const nH = bytes[i + 2];
        i += 3;
        const n = nL | (nH << 8);
        // Bytes per column: m=0/1 → 1, m=32/33 → 3
        const bytesPerCol = (m === 32 || m === 33) ? 3 : 1;
        skip(n * bytesPerCol);
        continue;
      }
      if (cmd === 0x26) { // ESC & y c1 c2 [x d...]xN  define user-defined chars
        if (i + 3 > limit) { i = limit; break; }
        const y = bytes[i];
        const c1 = bytes[i + 1];
        const c2 = bytes[i + 2];
        i += 3;
        const count = Math.max(0, c2 - c1 + 1);
        for (let k = 0; k < count && i < limit; k++) {
          const x = bytes[i];
          skip(1 + x * y);
        }
        continue;
      }
      if (cmd === 0x44) { // ESC D ... NUL
        while (i < limit && bytes[i] !== NUL) i++;
        if (i < limit) i++; // consume NUL
        continue;
      }
      if (cmd === 0x4a || cmd === 0x64) {
        // ESC J n / ESC d n — feed → treat as line break
        if (i < limit) i++;
        out.push(LINE_BREAK_SENTINEL);
        continue;
      }
      if (cmd === 0x74) { // ESC t n — codepage select
        if (i < limit) {
          const n = bytes[i++];
          cp = ESC_T_TO_CP[n] ?? cp;
        }
        continue;
      }
      const fixed = ESC_FIXED[cmd];
      if (fixed !== undefined && fixed >= 0) { skip(fixed); continue; }
      // Unknown ESC cmd — skip just the cmd byte (already consumed)
      continue;
    }

    // --- GS ---
    if (b === GS) {
      if (i + 1 >= limit) { i = limit; break; }
      const cmd = bytes[i + 1];
      i += 2;

      if (cmd === 0x6b) { // GS k m ... (barcode)
        if (i >= limit) break;
        const m = bytes[i];
        if (m <= 6) {
          // format 1: GS k m d1...dk NUL
          i += 1;
          while (i < limit && bytes[i] !== NUL) i++;
          if (i < limit) i++;
        } else {
          // format 2: GS k m n d1...dn
          if (i + 1 >= limit) { i = limit; break; }
          const n = bytes[i + 1];
          skip(2 + n);
        }
        continue;
      }
      if (cmd === 0x76) { // GS v 0 m xL xH yL yH d... (raster bit image)
        if (i + 5 > limit) { i = limit; break; }
        i += 1; // sub-fn (typically 0x30)
        const m = bytes[i]; void m;
        const xL = bytes[i + 1];
        const xH = bytes[i + 2];
        const yL = bytes[i + 3];
        const yH = bytes[i + 4];
        i += 5;
        const w = xL | (xH << 8);
        const h = yL | (yH << 8);
        skip(w * h);
        continue;
      }
      if (cmd === 0x28) { // GS ( fn pL pH ...
        if (i + 2 >= limit) { i = limit; break; }
        i += 1; // fn
        const pL = bytes[i];
        const pH = bytes[i + 1];
        i += 2;
        skip(pL | (pH << 8));
        continue;
      }
      if (cmd === 0x38 /* GS 8 L */ ) {
        // GS 8 L pL pH pK m fn ... — extended graphics block
        if (i + 6 > limit) { i = limit; break; }
        const pL = bytes[i];
        const pH = bytes[i + 1];
        const pK = bytes[i + 2];
        // Per spec the data length is (pL+pH*256+pK*65536+...) - the m,fn header counted in.
        // We approximate by skipping that many bytes from position i.
        const total = pL | (pH << 8) | (pK << 16);
        skip(total + 4);
        continue;
      }
      if (cmd === 0x56) { // GS V — cut. Treat as line break.
        if (i >= limit) break;
        const m = bytes[i];
        i += 1;
        if (m === 65 || m === 66 /* with feed n */) skip(1);
        out.push(LINE_BREAK_SENTINEL);
        continue;
      }
      const fixed = GS_FIXED[cmd];
      if (fixed !== undefined && fixed >= 0) { skip(fixed); continue; }
      continue;
    }

    // --- FS (kanji & NV image) ---
    if (b === FS) {
      if (i + 1 >= limit) { i = limit; break; }
      const cmd = bytes[i + 1];
      i += 2;
      if (cmd === 0x70) { // FS p n m  print NV bit image
        skip(2);
        continue;
      }
      if (cmd === 0x71) { // FS q n [data...]  define NV bit image (variable, big)
        if (i >= limit) break;
        const n = bytes[i];
        i += 1;
        for (let k = 0; k < n && i + 4 <= limit; k++) {
          const xL = bytes[i];
          const xH = bytes[i + 1];
          const yL = bytes[i + 2];
          const yH = bytes[i + 3];
          i += 4;
          const w = xL | (xH << 8);
          const h = yL | (yH << 8);
          skip(w * h);
        }
        continue;
      }
      const fixed = FS_FIXED[cmd];
      if (fixed !== undefined && fixed >= 0) { skip(fixed); continue; }
      continue;
    }

    if (b === DLE) {
      // DLE EOT n / DLE ENQ n / DLE DC4 ... — real-time, 2 trailing bytes is a safe upper bound
      skip(3);
      continue;
    }

    // Other low control bytes — drop
    if (b < 0x20) { i++; continue; }

    out.push(b);
    i++;
  }

  // Replace sentinels with \n, then decode the rest.
  // Build two buffers: one with sentinels mapped, one for decoder (which
  // doesn't know about our sentinel).
  const decoded: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    decoded.push(decodeWithCodepage(new Uint8Array(run), cp));
    run = [];
  };
  for (const b of out) {
    if (b === LINE_BREAK_SENTINEL) { flush(); decoded.push("\n"); }
    else run.push(b);
  }
  flush();

  return { text: decoded.join(""), codepage: cp, consumed: i };
}

/** Backwards-compatible: returns just the decoded text. */
export function extractTextFromEscPos(
  bytes: Uint8Array,
  opts: ParseOptions = {},
): string {
  return parseEscPos(bytes, opts).text;
}

/* -------------------------------------------------------------------------
 * Line splitting & filtering
 * ------------------------------------------------------------------------- */

const SEPARATOR_RE = /^[\s\-=_*~+#.•·—–]{3,}$/;
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export function textToStickerLines(
  text: string,
  opts: ParseOptions = {},
): string[] {
  const filterNoise = opts.filterReceiptNoise ?? true;
  const drop = opts.dropLinePattern;

  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(ZERO_WIDTH_RE, "");
    line = line.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (filterNoise && SEPARATOR_RE.test(line)) continue;
    if (drop && drop.test(line)) continue;
    out.push(line);
  }
  // De-dupe consecutive identical lines (POS sometimes prints the same name twice
  // — title + body — only the first should become a sticker).
  const dedup: string[] = [];
  for (const l of out) {
    if (dedup.length === 0 || dedup[dedup.length - 1] !== l) dedup.push(l);
  }
  return dedup;
}

/* -------------------------------------------------------------------------
 * TSPL builder
 * ------------------------------------------------------------------------- */

function escapeTspl(s: string): string {
  // TSPL has no real escape mechanism; quotes break the parser. Replace
  // problematic chars with safe equivalents.
  return s
    .replace(/\\/g, "/")
    .replace(/"/g, "'")
    // Strip remaining control chars.
    .replace(/[\x00-\x1f\x7f]/g, "");
}

/** Build TSPL for a list of sticker lines (one sticker per line). */
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
  const dpi = opts.dpi ?? 203;
  const cap = opts.maxStickers ?? 50;

  const dotsPerMm = dpi === 300 ? 12 : 8;
  const widthDots = w * dotsPerMm;
  const heightDots = h * dotsPerMm;
  const margin = Math.max(4, Math.round(dotsPerMm)); // ~1mm safety margin

  const header = [
    `SIZE ${w} mm,${h} mm`,
    `GAP ${gap} mm,0 mm`,
    `DIRECTION 1`,
    `REFERENCE 0,0`,
    `SPEED ${speed}`,
    `DENSITY ${density}`,
    `CODEPAGE UTF-8`,
    `CLS`,
  ];

  const out: string[] = [];
  let count = 0;
  for (const raw of lines) {
    if (count >= cap) break;
    const safe = escapeTspl(raw.trim());
    if (!safe) continue;

    // Choose strategy:
    //  - Short names (≤ 18 chars): single-line TEXT, dynamically sized.
    //  - Longer names: BLOCK with auto-wrap, font 3 (24px) at multiplier 2.
    out.push(...header);
    if (safe.length <= 18) {
      // Pick the largest multiplier that fits.
      const baseCharW = 12; // approx px per char at multiplier 1, font TSS24
      let mul = 4;
      while (mul > 1 && safe.length * baseCharW * mul > widthDots - margin * 2) mul--;
      const textPxW = Math.min(widthDots - margin * 2, safe.length * baseCharW * mul);
      const textPxH = 24 * mul;
      const x = Math.max(margin, Math.floor((widthDots - textPxW) / 2));
      const y = Math.max(margin, Math.floor((heightDots - textPxH) / 2));
      out.push(`TEXT ${x},${y},"TSS24.BF2",0,${mul},${mul},"${safe}"`);
    } else {
      // BLOCK x,y,width,height,"font",rot,xmul,ymul,space,align,fit,"text"
      // align: 1 left, 2 center, 3 right. fit: 0 off, 1 shrink-to-fit.
      const blockW = widthDots - margin * 2;
      const blockH = heightDots - margin * 2;
      const mul = 2;
      out.push(
        `BLOCK ${margin},${margin},${blockW},${blockH},"TSS24.BF2",0,${mul},${mul},0,2,1,"${safe}"`,
      );
    }
    out.push(`PRINT ${copies},1`);
    count++;
  }

  return out.join("\r\n") + (out.length ? "\r\n" : "");
}

/** Convenience: ESC/POS bytes → TSPL string. */
export function escPosToTspl(
  bytes: Uint8Array,
  parseOpts: ParseOptions = {},
  tsplOpts: TsplOptions = {},
): string {
  const { text } = parseEscPos(bytes, parseOpts);
  const lines = textToStickerLines(text, parseOpts);
  return buildTsplStickers(lines, tsplOpts);
}
