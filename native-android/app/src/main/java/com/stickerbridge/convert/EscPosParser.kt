package com.stickerbridge.convert

/**
 * Kotlin port of src/lib/escpos-to-tspl.ts (extractTextFromEscPos).
 * Strips ESC/POS control sequences and returns printable text.
 */
object EscPosParser {

    private const val ESC: Int = 0x1B
    private const val GS: Int = 0x1D
    private const val FS: Int = 0x1C
    private const val DLE: Int = 0x10

    private val ESC_FIXED = mapOf(
        0x21 to 1, 0x2D to 1, 0x33 to 1, 0x32 to 0, 0x40 to 0,
        0x45 to 1, 0x47 to 1, 0x4D to 1, 0x52 to 1, 0x61 to 1,
        0x64 to 1, 0x70 to 3, 0x74 to 1, 0x7B to 1
    )

    private val GS_FIXED = mapOf(
        0x21 to 1, 0x42 to 1, 0x4C to 2, 0x56 to 1, 0x57 to 2,
        0x66 to 1, 0x68 to 1, 0x77 to 1, 0x48 to 1
    )

    private val FS_FIXED = mapOf(
        0x21 to 1, 0x26 to 0, 0x2D to 1, 0x2E to 0,
        0x43 to 1, 0x53 to 2, 0x57 to 1
    )

    fun extractText(bytes: ByteArray): String {
        val out = ArrayList<Byte>(bytes.size)
        var i = 0
        while (i < bytes.size) {
            val b = bytes[i].toInt() and 0xFF
            when (b) {
                ESC -> {
                    if (i + 1 >= bytes.size) { i = bytes.size; break }
                    val cmd = bytes[i + 1].toInt() and 0xFF
                    i += 2
                    val skip = ESC_FIXED[cmd]
                    if (skip != null) i += skip
                    else if (cmd == 0x2A && i + 1 < bytes.size) {
                        i += 2 + ((bytes[i].toInt() and 0xFF) or ((bytes[i + 1].toInt() and 0xFF) shl 8))
                    } else if (cmd == 0x26 && i + 2 < bytes.size) {
                        val y = bytes[i].toInt() and 0xFF
                        val c1 = bytes[i + 1].toInt() and 0xFF
                        val c2 = bytes[i + 2].toInt() and 0xFF
                        i += 3
                        val count = c2 - c1 + 1
                        repeat(count) {
                            if (i >= bytes.size) return@repeat
                            val x = bytes[i].toInt() and 0xFF
                            i += 1 + x * y
                        }
                    }
                }
                GS -> {
                    if (i + 1 >= bytes.size) { i = bytes.size; break }
                    val cmd = bytes[i + 1].toInt() and 0xFF
                    i += 2
                    val skip = GS_FIXED[cmd]
                    if (skip != null) i += skip
                    else if (cmd == 0x6B && i < bytes.size) {
                        val m = bytes[i].toInt() and 0xFF
                        if (m <= 6) {
                            i += 1
                            while (i < bytes.size && bytes[i].toInt() != 0) i++
                            i++
                        } else if (i + 1 < bytes.size) {
                            val n = bytes[i + 1].toInt() and 0xFF
                            i += 2 + n
                        }
                    } else if (cmd == 0x76 && i + 4 < bytes.size) {
                        i += 1 // m
                        val xL = bytes[i].toInt() and 0xFF
                        val xH = bytes[i + 1].toInt() and 0xFF
                        val yL = bytes[i + 2].toInt() and 0xFF
                        val yH = bytes[i + 3].toInt() and 0xFF
                        i += 4
                        val w = xL or (xH shl 8)
                        val h = yL or (yH shl 8)
                        i += w * h
                    } else if (cmd == 0x28 && i + 2 < bytes.size) {
                        i += 1 // fn
                        val pL = bytes[i].toInt() and 0xFF
                        val pH = bytes[i + 1].toInt() and 0xFF
                        i += 2 + (pL or (pH shl 8))
                    }
                }
                FS -> {
                    if (i + 1 >= bytes.size) { i = bytes.size; break }
                    val cmd = bytes[i + 1].toInt() and 0xFF
                    i += 2
                    val skip = FS_FIXED[cmd]
                    if (skip != null) i += skip
                }
                DLE -> i += 3
                else -> {
                    if (b < 0x20 && b != 0x0A && b != 0x09) {
                        i += 1
                    } else {
                        out.add(bytes[i])
                        i += 1
                    }
                }
            }
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }

    fun textToStickerLines(text: String): List<String> =
        text.split(Regex("\\r?\\n"))
            .map { it.replace(Regex("\\s+"), " ").trim() }
            .filter { it.isNotEmpty() }
}
