package com.stickerbridge.convert

data class TsplOptions(
    val widthMm: Int = 40,
    val heightMm: Int = 30,
    val gapMm: Int = 3,
    val speed: Int = 4,
    val density: Int = 8,
    val copies: Int = 1,
)

object TsplBuilder {
    /**
     * Build TSPL bytes for one sticker per line, centered, gap-sensor mode.
     * Auto-shrinks the font multiplier for long names.
     */
    fun build(lines: List<String>, opts: TsplOptions = TsplOptions()): ByteArray {
        val dotsPerMm = 8 // 203 dpi
        val widthDots = opts.widthMm * dotsPerMm
        val heightDots = opts.heightMm * dotsPerMm
        val header = listOf(
            "SIZE ${opts.widthMm} mm,${opts.heightMm} mm",
            "GAP ${opts.gapMm} mm,0 mm",
            "DIRECTION 1",
            "REFERENCE 0,0",
            "SPEED ${opts.speed}",
            "DENSITY ${opts.density}",
            "CLS",
        )
        val sb = StringBuilder()
        for (raw in lines) {
            val name = raw.trim()
            if (name.isEmpty()) continue
            var mul = 3
            if (name.length > 10) mul = 2
            if (name.length > 18) mul = 1
            val charWidthApprox = 12 * mul
            val textPxWidth = minOf(widthDots - 8, name.length * charWidthApprox)
            val x = maxOf(4, (widthDots - textPxWidth) / 2)
            val y = maxOf(8, (heightDots - 24 * mul) / 2)
            val safe = name.replace("\"", "'")
            for (h in header) sb.append(h).append("\r\n")
            sb.append("TEXT $x,$y,\"TSS24.BF2\",0,$mul,$mul,\"$safe\"\r\n")
            sb.append("PRINT ${opts.copies},1\r\n")
        }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }

    fun fromEscPos(bytes: ByteArray, opts: TsplOptions = TsplOptions()): ByteArray {
        val text = EscPosParser.extractText(bytes)
        val lines = EscPosParser.textToStickerLines(text)
        return build(lines, opts)
    }
}
