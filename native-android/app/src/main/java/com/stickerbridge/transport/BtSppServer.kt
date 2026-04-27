package com.stickerbridge.transport

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.util.UUID

/**
 * Listens for incoming Bluetooth Classic SPP connections.
 * Uses the standard SPP UUID so generic POS "Bluetooth printer" drivers
 * recognise this device as a printer when they pair.
 *
 * IMPORTANT: caller must have BLUETOOTH_CONNECT permission already granted.
 */
class BtSppServer(
    private val adapter: BluetoothAdapter,
    private val scope: CoroutineScope,
    private val onJob: (ByteArray, String) -> Unit,
    private val onLog: (String) -> Unit = {},
) {
    companion object {
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        const val SDP_NAME = "StickerBridgePrinter"
    }

    private var server: BluetoothServerSocket? = null
    private var job: Job? = null

    @SuppressLint("MissingPermission")
    fun start() {
        if (job != null) return
        job = scope.launch(Dispatchers.IO) {
            try {
                server = adapter.listenUsingRfcommWithServiceRecord(SDP_NAME, SPP_UUID)
                onLog("Bluetooth SPP server listening as \"$SDP_NAME\"")
                while (isActive) {
                    val client: BluetoothSocket = try {
                        server?.accept() ?: break
                    } catch (_: Throwable) { break }
                    launch { handle(client) }
                }
            } catch (e: SecurityException) {
                onLog("Bluetooth permission missing: ${e.message}")
            } catch (e: Throwable) {
                onLog("Bluetooth SPP error: ${e.message}")
            }
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun handle(client: BluetoothSocket) = withContext(Dispatchers.IO) {
        val remoteName = try { client.remoteDevice?.name ?: "unknown" } catch (_: Throwable) { "unknown" }
        onLog("BT connection from $remoteName")
        client.use { sock ->
            val buf = ByteArray(2048)
            val acc = ByteArrayOutputStream()
            try {
                val ins = sock.inputStream
                // Read until the remote stops sending for ~800 ms
                var lastRead = System.currentTimeMillis()
                while (true) {
                    if (ins.available() > 0) {
                        val n = ins.read(buf)
                        if (n <= 0) break
                        acc.write(buf, 0, n)
                        lastRead = System.currentTimeMillis()
                    } else {
                        if (System.currentTimeMillis() - lastRead > 800 && acc.size() > 0) break
                        delay(50)
                    }
                }
            } catch (_: Throwable) { /* disconnected */ }
            val payload = acc.toByteArray()
            if (payload.isNotEmpty()) onJob(payload, "BT $remoteName")
        }
    }

    fun stop() {
        try { server?.close() } catch (_: Throwable) {}
        server = null
        job?.cancel()
        job = null
        onLog("Bluetooth SPP server stopped")
    }
}
