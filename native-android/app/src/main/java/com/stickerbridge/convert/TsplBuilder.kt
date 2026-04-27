package com.stickerbridge.convert

data class TsplOptions(
    val widthMm: Int = 40,
    val heightMm: Int = 30,
    val gapMm: Int = 3,
    val speed: Int = 4,
    val density: Int = 8,
    val copies: Int = 1,
    /** Officom OC8600 = 203. */
    val dpi: Int = 203,
    val maxStickers: Int = 50,
)

/**
 * Builds TSPL byte streams optimised for the Officom OC8600 with 40×30 mm
 * gap labels. Mirrors the TS reference implementation (see escpos-to-tspl.ts).
 *
 *  - Short names (≤ 18 chars) → centered TEXT with auto-sized font multiplier.
 *  - Longer names              → BLOCK with auto-shrink and center alignment.
 *  - All input is sanitized: quotes → apostrophes, backslash → forward slash,
 *    control bytes stripped (TSPL has no escape mechanism).
 */
object TsplBuilder {

    fun build(lines: List<String>, opts: TsplOptions = TsplOptions()): ByteArray {
        val dotsPerMm = if (opts.dpi >= 300) 12 else 8
        val widthDots = opts.widthMm * dotsPerMm
        val heightDots = opts.heightMm * dotsPerMm
        val margin = maxOf(4, dotsPerMm) // ≈1 mm safety margin

        val header = listOf(
            "SIZE ${opts.widthMm} mm,${opts.heightMm} mm",
            "GAP ${opts.gapMm} mm,0 mm",
            "DIRECTION 1",
            "REFERENCE 0,0",
            "SPEED ${opts.speed}",
            "DENSITY ${opts.density}",
            "CODEPAGE UTF-8",
            "CLS",
        )

        val sb = StringBuilder()
        var emitted = 0
        for (raw in lines) {
            if (emitted >= opts.maxStickers) break
            val safe = sanitize(raw.trim())
            if (safe.isEmpty()) continue

            for (h in header) sb.append(h).append("\r\n")

            if (safe.length <= 18) {
                val baseCharW = 12
                var mul = 4
                while (mul > 1 && safe.length * baseCharW * mul > widthDots - margin * 2) mul--
                val textPxW = minOf(widthDots - margin * 2, safe.length * baseCharW * mul)
                val textPxH = 24 * mul
                val x = maxOf(margin, (widthDots - textPxW) / 2)
                val y = maxOf(margin, (heightDots - textPxH) / 2)
                sb.append("TEXT ").append(x).append(',').append(y)
                    .append(",\"TSS24.BF2\",0,").append(mul).append(',').append(mul)
                    .append(",\"").append(safe).append("\"\r\n")
            } else {
                val blockW = widthDots - margin * 2
                val blockH = heightDots - margin * 2
                val mul = 2
                // BLOCK x,y,w,h,"font",rot,xmul,ymul,space,align,fit,"text"
                sb.append("BLOCK ").append(margin).append(',').append(margin).append(',')
                    .append(blockW).append(',').append(blockH)
                    .append(",\"TSS24.BF2\",0,").append(mul).append(',').append(mul)
                    .append(",0,2,1,\"").append(safe).append("\"\r\n")
            }
            sb.append("PRINT ").append(opts.copies).append(",1\r\n")
            emitted++
        }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    fun fromEscPos(
        bytes: ByteArray,
        parseOpts: EscPosParser.Options = EscPosParser.Options(),
        tsplOpts: TsplOptions = TsplOptions(),
    ): ByteArray {
        val text = EscPosParser.parse(bytes, parseOpts).text
        val lines = EscPosParser.textToStickerLines(text, parseOpts)
        return build(lines, tsplOpts)
    }

    private fun sanitize(s: String): String {
        val sb = StringBuilder(s.length)
        for (ch in s) {
            when {
                ch == '\\' -> sb.append('/')
                ch == '"' -> sb.append('\'')
                ch.code < 0x20 || ch.code == 0x7F -> { /* drop */ }
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }
}
