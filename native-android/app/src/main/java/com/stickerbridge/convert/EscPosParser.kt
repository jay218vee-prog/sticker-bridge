package com.stickerbridge.convert

import java.nio.charset.Charset
import java.nio.charset.CharsetDecoder
import java.nio.charset.CodingErrorAction

/**
 * ESC/POS  →  printable-text parser.
 *
 * Direct port of src/lib/escpos-to-tspl.ts. Same semantics, same edge
 * cases, same unit-tested behaviour. See that file for the test suite
 * (42 cases) describing the contract.
 *
 *  - Strips Epson + Star ESC/POS commands with proper variable-length
 *    handling (GS k barcode, GS v raster, GS ( fn pL pH, GS / image,
 *    ESC * bit image, ESC & user chars, FS p / FS q NV image).
 *  - Tracks codepage via ESC t n; decodes accordingly. UTF-8 is
 *    preferred when the byte stream is valid UTF-8 (most modern Android
 *    POS apps emit UTF-8 regardless of declared codepage).
 *  - Treats LF, CR, CRLF, FF, ESC J n, ESC d n and GS V (cut) as line
 *    breaks so multi-item jobs split into multiple stickers.
 *  - Bounds-checks every read: truncated streams cannot crash it.
 */
object EscPosParser {

    data class Options(
        val defaultCodepage: Int = 437,
        val maxBytes: Int = 1_000_000,
        val filterReceiptNoise: Boolean = true,
        val dropLinePattern: Regex? = null,
    )

    data class Result(val text: String, val codepage: Int, val consumed: Int)

    private const val ESC = 0x1B
    private const val GS  = 0x1D
    private const val FS  = 0x1C
    private const val DLE = 0x10
    private const val LF  = 0x0A
    private const val CR  = 0x0D
    private const val FF  = 0x0C
    private const val HT  = 0x09
    private const val CAN = 0x18
    private const val NUL = 0x00

    /** Sentinel injected for non-textual line breaks (cut, feed N). 0xFF is
     *  not a valid leading byte in any single-byte codepage we use, so it
     *  cannot collide with real text. */
    private const val LINE_BREAK_SENTINEL = 0xFF

    private val ESC_FIXED = mapOf(
        0x20 to 1, 0x21 to 1, 0x24 to 2, 0x25 to 1, 0x2D to 1, 0x32 to 0,
        0x33 to 1, 0x3D to 1, 0x3F to 1, 0x40 to 0, 0x45 to 1, 0x46 to 1,
        0x47 to 1, 0x48 to 1, 0x49 to 1, 0x4A to 1, 0x4B to 1, 0x4C to 0,
        0x4D to 1, 0x52 to 1, 0x53 to 0, 0x54 to 1, 0x56 to 1, 0x57 to 8,
        0x5C to 2, 0x61 to 1, 0x62 to 1, 0x63 to 2, 0x64 to 1, 0x65 to 1,
        0x66 to 2, 0x67 to 1, 0x69 to 0, 0x6D to 0, 0x70 to 3, 0x72 to 1,
        0x74 to 1, 0x76 to 0, 0x7B to 1,
    )

    private val GS_FIXED = mapOf(
        0x21 to 1, 0x24 to 2, 0x2F to 1, 0x3A to 0, 0x42 to 1, 0x43 to 0,
        0x45 to 1, 0x48 to 1, 0x49 to 1, 0x4C to 2, 0x50 to 2, 0x54 to 1,
        0x57 to 2, 0x5C to 2, 0x61 to 1, 0x62 to 1, 0x66 to 1, 0x67 to 0,
        0x68 to 1, 0x6A to 1, 0x72 to 1, 0x77 to 1, 0x7A to 1,
    )

    private val FS_FIXED = mapOf(
        0x21 to 1, 0x26 to 0, 0x2D to 1, 0x2E to 0, 0x32 to 4,
        0x43 to 1, 0x53 to 2, 0x57 to 1,
    )

    // ESC t n  →  codepage number
    private val ESC_T_TO_CP = mapOf(
        0 to 437, 1 to 850, 2 to 860, 3 to 863, 4 to 865, 5 to 852, 6 to 866,
        7 to 855, 8 to 857, 9 to 862, 10 to 864, 11 to 869, 13 to 864,
        14 to 1252, 15 to 858, 16 to 1252, 17 to 1252, 18 to 852, 19 to 858,
        20 to 874, 21 to 1252, 32 to 1252, 33 to 1252, 34 to 1252, 35 to 1252,
        36 to 1252, 37 to 1252, 38 to 1252, 39 to 1252, 40 to 1252, 41 to 1252,
        42 to 1252, 43 to 1252, 44 to 1252, 45 to 1252, 46 to 1252, 47 to 1252,
        48 to 1252,
    )

    private val CP_TO_CHARSET = mapOf(
        437 to "IBM437", 850 to "IBM850", 852 to "IBM852", 855 to "IBM855",
        857 to "IBM857", 858 to "IBM00858", 860 to "IBM860", 862 to "IBM862",
        863 to "IBM863", 864 to "IBM864", 865 to "IBM865", 866 to "IBM866",
        869 to "IBM869", 874 to "x-IBM874", 1252 to "windows-1252",
    )

    fun parse(bytes: ByteArray, opts: Options = Options()): Result {
        val limit = minOf(bytes.size, opts.maxBytes)
        var cp = opts.defaultCodepage
        val out = ArrayList<Int>(limit)
        var i = 0

        fun skip(n: Int) {
            if (n < 0) return
            i += n
            if (i > limit) i = limit
        }
        fun u(idx: Int): Int = bytes[idx].toInt() and 0xFF

        while (i < limit) {
            val b = u(i)

            // Line / control bytes
            when (b) {
                LF, FF -> { out.add(LINE_BREAK_SENTINEL); i++; continue }
                CR -> {
                    out.add(LINE_BREAK_SENTINEL); i++
                    if (i < limit && u(i) == LF) i++
                    continue
                }
                HT -> { out.add(0x20); i++; continue }
                CAN -> {
                    while (out.isNotEmpty() && out.last() != LINE_BREAK_SENTINEL) {
                        out.removeAt(out.size - 1)
                    }
                    i++; continue
                }
                NUL -> { i++; continue }
                DLE -> { skip(3); continue }
            }

            if (b == ESC) {
                if (i + 1 >= limit) { i = limit; break }
                val cmd = u(i + 1); i += 2
                when (cmd) {
                    0x2A -> { // ESC * m nL nH d...
                        if (i + 3 > limit) { i = limit; break }
                        val m = u(i); val nL = u(i + 1); val nH = u(i + 2); i += 3
                        val n = nL or (nH shl 8)
                        val bpc = if (m == 32 || m == 33) 3 else 1
                        skip(n * bpc); continue
                    }
                    0x26 -> { // ESC & y c1 c2 [x d...]
                        if (i + 3 > limit) { i = limit; break }
                        val y = u(i); val c1 = u(i + 1); val c2 = u(i + 2); i += 3
                        val count = maxOf(0, c2 - c1 + 1)
                        var k = 0
                        while (k < count && i < limit) {
                            val x = u(i); skip(1 + x * y); k++
                        }
                        continue
                    }
                    0x44 -> { // ESC D ... NUL
                        while (i < limit && u(i) != NUL) i++
                        if (i < limit) i++
                        continue
                    }
                    0x4A, 0x64 -> { // ESC J n / ESC d n  → soft line break
                        if (i < limit) i++
                        out.add(LINE_BREAK_SENTINEL); continue
                    }
                    0x74 -> { // ESC t n
                        if (i < limit) {
                            val n = u(i); i++
                            ESC_T_TO_CP[n]?.let { cp = it }
                        }
                        continue
                    }
                    else -> {
                        val s = ESC_FIXED[cmd]
                        if (s != null && s >= 0) skip(s)
                        continue
                    }
                }
            }

            if (b == GS) {
                if (i + 1 >= limit) { i = limit; break }
                val cmd = u(i + 1); i += 2
                when (cmd) {
                    0x6B -> { // GS k m ...
                        if (i >= limit) break
                        val m = u(i)
                        if (m <= 6) {
                            i += 1
                            while (i < limit && u(i) != NUL) i++
                            if (i < limit) i++
                        } else {
                            if (i + 1 >= limit) { i = limit; break }
                            val n = u(i + 1); skip(2 + n)
                        }
                        continue
                    }
                    0x76 -> { // GS v 0 m xL xH yL yH d...
                        if (i + 5 > limit) { i = limit; break }
                        i += 1 // sub-fn
                        val xL = u(i + 1); val xH = u(i + 2); val yL = u(i + 3); val yH = u(i + 4)
                        i += 5
                        val w = xL or (xH shl 8); val h = yL or (yH shl 8)
                        skip(w * h); continue
                    }
                    0x28 -> { // GS ( fn pL pH ...
                        if (i + 2 >= limit) { i = limit; break }
                        i += 1 // fn
                        val pL = u(i); val pH = u(i + 1); i += 2
                        skip(pL or (pH shl 8)); continue
                    }
                    0x38 -> { // GS 8 L pL pH pK ...
                        if (i + 6 > limit) { i = limit; break }
                        val pL = u(i); val pH = u(i + 1); val pK = u(i + 2)
                        val total = pL or (pH shl 8) or (pK shl 16)
                        skip(total + 4); continue
                    }
                    0x56 -> { // GS V — cut
                        if (i >= limit) break
                        val m = u(i); i += 1
                        if (m == 65 || m == 66) skip(1)
                        out.add(LINE_BREAK_SENTINEL); continue
                    }
                    else -> {
                        val s = GS_FIXED[cmd]
                        if (s != null && s >= 0) skip(s)
                        continue
                    }
                }
            }

            if (b == FS) {
                if (i + 1 >= limit) { i = limit; break }
                val cmd = u(i + 1); i += 2
                when (cmd) {
                    0x70 -> { skip(2); continue } // FS p n m
                    0x71 -> { // FS q n [(xL xH yL yH d...)×n]
                        if (i >= limit) break
                        val n = u(i); i += 1
                        var k = 0
                        while (k < n && i + 4 <= limit) {
                            val xL = u(i); val xH = u(i + 1); val yL = u(i + 2); val yH = u(i + 3)
                            i += 4
                            val w = xL or (xH shl 8); val h = yL or (yH shl 8)
                            skip(w * h); k++
                        }
                        continue
                    }
                    else -> {
                        val s = FS_FIXED[cmd]
                        if (s != null && s >= 0) skip(s)
                        continue
                    }
                }
            }

            // Other low control bytes — drop
            if (b < 0x20) { i++; continue }

            out.add(b); i++
        }

        // Decode runs between sentinels with the active codepage.
        val sb = StringBuilder()
        val run = ArrayList<Byte>(out.size)
        fun flush() {
            if (run.isEmpty()) return
            sb.append(decode(run.toByteArray(), cp))
            run.clear()
        }
        for (v in out) {
            if (v == LINE_BREAK_SENTINEL) { flush(); sb.append('\n') }
            else run.add(v.toByte())
        }
        flush()
        return Result(sb.toString(), cp, i)
    }

    /** Public legacy API used elsewhere in the project. */
    fun extractText(bytes: ByteArray, opts: Options = Options()): String =
        parse(bytes, opts).text

    fun textToStickerLines(text: String, opts: Options = Options()): List<String> {
        val separatorRe = Regex("^[\\s\\-=_*~+#.•·—–]{3,}$")
        val zeroWidthRe = Regex("[\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]")
        val ws = Regex("\\s+")
        val raw = text.split(Regex("\\r?\\n")).asSequence()
            .map { it.replace(zeroWidthRe, "") }
            .map { it.replace(ws, " ").trim() }
            .filter { it.isNotEmpty() }
            .filter { !opts.filterReceiptNoise || !separatorRe.matches(it) }
            .filter { opts.dropLinePattern?.containsMatchIn(it) != true }
            .toList()
        // De-dupe consecutive duplicates
        val out = ArrayList<String>(raw.size)
        for (l in raw) if (out.isEmpty() || out.last() != l) out.add(l)
        return out
    }

    private fun decode(bytes: ByteArray, cp: Int): String {
        if (isLikelyUtf8(bytes)) {
            try {
                val dec: CharsetDecoder = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                return dec.decode(java.nio.ByteBuffer.wrap(bytes)).toString()
            } catch (_: Throwable) { /* fall through */ }
        }
        val name = CP_TO_CHARSET[cp] ?: "windows-1252"
        return try {
            String(bytes, Charset.forName(name))
        } catch (_: Throwable) {
            // Latin-1 byte-for-byte fallback
            val sb = StringBuilder(bytes.size)
            for (b in bytes) sb.append((b.toInt() and 0xFF).toChar())
            sb.toString()
        }
    }

    private fun isLikelyUtf8(bytes: ByteArray): Boolean {
        var i = 0; var multi = 0
        while (i < bytes.size) {
            val b = bytes[i].toInt() and 0xFF
            if (b < 0x80) { i++; continue }
            val need: Int = when {
                (b and 0xE0) == 0xC0 -> 1
                (b and 0xF0) == 0xE0 -> 2
                (b and 0xF8) == 0xF0 -> 3
                else -> return false
            }
            if (i + need >= bytes.size) return false
            for (k in 1..need) if ((bytes[i + k].toInt() and 0xC0) != 0x80) return false
            multi++; i += 1 + need
        }
        return multi > 0
    }
}
