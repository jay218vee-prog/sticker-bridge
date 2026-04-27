package com.stickerbridge

import android.app.*
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.stickerbridge.convert.TsplBuilder
import com.stickerbridge.convert.TsplOptions
import com.stickerbridge.convert.EscPosParser
import com.stickerbridge.printer.PrinterClient
import com.stickerbridge.transport.BtSppServer
import com.stickerbridge.transport.TcpListener
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Foreground service that owns the TCP + Bluetooth SPP listeners and the
 * printer connection. Without a foreground service, Android kills these
 * listeners as soon as the screen goes off.
 */
class BridgeService : Service() {

    data class LogEntry(
        val id: Long = System.currentTimeMillis(),
        val source: String,
        val bytesIn: Int,
        val bytesOut: Int,
        val lines: List<String>,
        val ok: Boolean,
        val message: String? = null,
    )

    data class State(
        val tcpOn: Boolean = false,
        val btOn: Boolean = false,
        val tcpPort: Int = 9100,
        val printerName: String? = null,
        val printerConnected: Boolean = false,
        val labelW: Int = 40,
        val labelH: Int = 30,
        val gap: Int = 3,
        val log: List<LogEntry> = emptyList(),
        val statusLines: List<String> = emptyList(),
    )

    inner class LocalBinder : Binder() { val service: BridgeService get() = this@BridgeService }
    private val binder = LocalBinder()
    override fun onBind(intent: Intent?): IBinder = binder

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private lateinit var adapter: BluetoothAdapter
    private val printer by lazy { PrinterClient(adapter) }
    private var tcp: TcpListener? = null
    private var btServer: BtSppServer? = null

    override fun onCreate() {
        super.onCreate()
        adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        startForeground(NOTIF_ID, buildNotification("Sticker Bridge running"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    // ---------- public API exposed to MainActivity ----------

    fun startTcp(port: Int) {
        if (tcp != null) return
        _state.update { it.copy(tcpPort = port) }
        tcp = TcpListener(
            port = port,
            scope = scope,
            onJob = { bytes, src -> handleJob(bytes, src) },
            onLog = { line -> appendStatus(line) },
        ).also { it.start() }
        _state.update { it.copy(tcpOn = true) }
    }

    fun stopTcp() {
        tcp?.stop(); tcp = null
        _state.update { it.copy(tcpOn = false) }
    }

    fun startBluetoothSpp() {
        if (btServer != null) return
        btServer = BtSppServer(
            adapter = adapter,
            scope = scope,
            onJob = { bytes, src -> handleJob(bytes, src) },
            onLog = { line -> appendStatus(line) },
        ).also { it.start() }
        _state.update { it.copy(btOn = true) }
    }

    fun stopBluetoothSpp() {
        btServer?.stop(); btServer = null
        _state.update { it.copy(btOn = false) }
    }

    fun pairedPrinters() = printer.pairedDevices()

    suspend fun connectPrinter(deviceAddress: String): Result<Unit> {
        val device = printer.pairedDevices().firstOrNull { it.address == deviceAddress }
            ?: return Result.failure(IllegalArgumentException("Device not paired"))
        val r = printer.connect(device)
        _state.update {
            it.copy(
                printerConnected = printer.isConnected(),
                printerName = printer.connectedName() ?: device.address,
            )
        }
        return r
    }

    fun disconnectPrinter() {
        printer.disconnect()
        _state.update { it.copy(printerConnected = false, printerName = null) }
    }

    fun setLabel(w: Int, h: Int, gap: Int) {
        _state.update { it.copy(labelW = w, labelH = h, gap = gap) }
    }

    // ---------- internals ----------

    private fun handleJob(bytes: ByteArray, source: String) {
        scope.launch {
            val s = _state.value
            val text = EscPosParser.extractText(bytes)
            val lines = EscPosParser.textToStickerLines(text)
            val tspl = TsplBuilder.build(
                lines,
                TsplOptions(widthMm = s.labelW, heightMm = s.labelH, gapMm = s.gap)
            )
            val sendResult = if (printer.isConnected()) printer.send(tspl)
                             else Result.failure(IllegalStateException("Printer not connected"))
            val entry = LogEntry(
                source = source,
                bytesIn = bytes.size,
                bytesOut = tspl.size,
                lines = lines,
                ok = sendResult.isSuccess,
                message = sendResult.exceptionOrNull()?.message,
            )
            _state.update { it.copy(log = (listOf(entry) + it.log).take(50)) }
        }
    }

    private fun appendStatus(line: String) {
        _state.update { it.copy(statusLines = (listOf(line) + it.statusLines).take(20)) }
    }

    // ---------- notification ----------

    private fun buildNotification(text: String): Notification {
        val channelId = "sticker_bridge"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(channelId, "Bridge", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Sticker Bridge")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        stopTcp()
        stopBluetoothSpp()
        printer.disconnect()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val NOTIF_ID = 1001
        fun start(ctx: Context) {
            val i = Intent(ctx, BridgeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }
}
