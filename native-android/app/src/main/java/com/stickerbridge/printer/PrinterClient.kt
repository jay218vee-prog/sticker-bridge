package com.stickerbridge.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

/**
 * Bluetooth Classic SPP client to the Officom OC8600.
 * (OC8600 is NOT BLE — do not use BluetoothGatt.)
 */
class PrinterClient(private val adapter: BluetoothAdapter) {

    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private var socket: BluetoothSocket? = null
    private var device: BluetoothDevice? = null

    @SuppressLint("MissingPermission")
    fun pairedDevices(): List<BluetoothDevice> =
        try { adapter.bondedDevices?.toList() ?: emptyList() } catch (_: SecurityException) { emptyList() }

    @SuppressLint("MissingPermission")
    suspend fun connect(target: BluetoothDevice): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            disconnect()
            adapter.cancelDiscovery()
            val s = target.createRfcommSocketToServiceRecord(sppUuid)
            s.connect()
            socket = s
            device = target
            Result.success(Unit)
        } catch (e: Throwable) {
            Result.failure(e)
        }
    }

    fun isConnected(): Boolean = socket?.isConnected == true

    @SuppressLint("MissingPermission")
    fun connectedName(): String? =
        try { device?.name } catch (_: SecurityException) { null }

    suspend fun send(data: ByteArray): Result<Unit> = withContext(Dispatchers.IO) {
        val s = socket ?: return@withContext Result.failure(IllegalStateException("Printer not connected"))
        try {
            val out = s.outputStream
            // Chunk to be friendly to slow stacks
            val chunk = 256
            var i = 0
            while (i < data.size) {
                val end = minOf(i + chunk, data.size)
                out.write(data, i, end - i)
                out.flush()
                i = end
            }
            Result.success(Unit)
        } catch (e: Throwable) {
            Result.failure(e)
        }
    }

    fun disconnect() {
        try { socket?.close() } catch (_: Throwable) {}
        socket = null
        device = null
    }
}
