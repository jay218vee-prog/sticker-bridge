package com.stickerbridge.transport

import kotlinx.coroutines.*
import java.net.ServerSocket
import java.net.Socket

/**
 * Accepts raw TCP connections on the given port (typical: 9100).
 * Streams every received chunk to [onJob]. POS apps usually open a socket,
 * write the ESC/POS bytes for the receipt, then close — so we drain the
 * socket fully and emit a single job per connection.
 */
class TcpListener(
    private val port: Int,
    private val scope: CoroutineScope,
    private val onJob: (ByteArray, String) -> Unit,
    private val onLog: (String) -> Unit = {},
) {
    private var server: ServerSocket? = null
    private var job: Job? = null

    fun start() {
        if (job != null) return
        job = scope.launch(Dispatchers.IO) {
            try {
                server = ServerSocket(port).also { it.reuseAddress = true }
                onLog("TCP listening on :$port")
                while (isActive) {
                    val client = try { server?.accept() ?: break } catch (_: Throwable) { break }
                    launch { handle(client) }
                }
            } catch (e: Throwable) {
                onLog("TCP error: ${e.message}")
            }
        }
    }

    private suspend fun handle(client: Socket) = withContext(Dispatchers.IO) {
        client.use { sock ->
            val ip = sock.inetAddress.hostAddress ?: "unknown"
            onLog("TCP connection from $ip")
            val buf = ByteArray(4096)
            val acc = ByteArrayBuilder()
            sock.soTimeout = 1500
            try {
                val ins = sock.getInputStream()
                while (true) {
                    val n = try { ins.read(buf) } catch (_: java.net.SocketTimeoutException) { -1 }
                    if (n <= 0) break
                    acc.append(buf, 0, n)
                }
            } catch (_: Throwable) { /* socket closed */ }
            val payload = acc.toByteArray()
            if (payload.isNotEmpty()) onJob(payload, "TCP $ip")
        }
    }

    fun stop() {
        try { server?.close() } catch (_: Throwable) {}
        server = null
        job?.cancel()
        job = null
        onLog("TCP listener stopped")
    }

    private class ByteArrayBuilder {
        private val bos = java.io.ByteArrayOutputStream()
        fun append(buf: ByteArray, off: Int, len: Int) = bos.write(buf, off, len)
        fun toByteArray(): ByteArray = bos.toByteArray()
    }
}
