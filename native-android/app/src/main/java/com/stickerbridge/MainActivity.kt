package com.stickerbridge

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.stickerbridge.ui.theme.StickerBridgeTheme
import kotlinx.coroutines.launch
import java.net.NetworkInterface

class MainActivity : ComponentActivity() {

    private var service: BridgeService? = null
    private val bound = mutableStateOf(false)

    private val conn = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, b: IBinder?) {
            service = (b as BridgeService.LocalBinder).service
            bound.value = true
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            service = null; bound.value = false
        }
    }

    private val permLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* user-driven retries */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestRuntimePermissions()
        BridgeService.start(this)
        bindService(Intent(this, BridgeService::class.java), conn, Context.BIND_AUTO_CREATE)

        setContent {
            StickerBridgeTheme {
                if (bound.value && service != null) BridgeScreen(service!!, ::wifiIp)
                else Surface { Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() } }
            }
        }
    }

    override fun onDestroy() {
        try { unbindService(conn) } catch (_: Throwable) {}
        super.onDestroy()
    }

    private fun requestRuntimePermissions() {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms += Manifest.permission.BLUETOOTH_CONNECT
            perms += Manifest.permission.BLUETOOTH_SCAN
            perms += Manifest.permission.BLUETOOTH_ADVERTISE
        } else {
            perms += Manifest.permission.ACCESS_FINE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += Manifest.permission.POST_NOTIFICATIONS
        }
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) permLauncher.launch(missing.toTypedArray())
    }

    private fun wifiIp(): String {
        // Prefer non-loopback IPv4 from active interfaces (works for both WiFi and Ethernet/USB tether)
        try {
            for (nif in NetworkInterface.getNetworkInterfaces()) {
                if (!nif.isUp || nif.isLoopback) continue
                for (addr in nif.inetAddresses) {
                    if (!addr.isLoopbackAddress && addr.hostAddress?.contains(':') == false) {
                        return addr.hostAddress ?: "?"
                    }
                }
            }
        } catch (_: Throwable) {}
        // Fallback to WifiManager
        return try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val ip = wm.connectionInfo.ipAddress
            "%d.%d.%d.%d".format(ip and 0xff, (ip shr 8) and 0xff, (ip shr 16) and 0xff, (ip shr 24) and 0xff)
        } catch (_: Throwable) { "?" }
    }
}

@Composable
private fun BridgeScreen(svc: BridgeService, ipProvider: () -> String) {
    val state by svc.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var port by remember { mutableStateOf(state.tcpPort.toString()) }
    var labelW by remember { mutableStateOf(state.labelW.toString()) }
    var labelH by remember { mutableStateOf(state.labelH.toString()) }
    var gap by remember { mutableStateOf(state.gap.toString()) }
    var pickerOpen by remember { mutableStateOf(false) }
    val ip = remember { ipProvider() }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Sticker Bridge") })
    }) { pad ->
        Column(
            Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Printer card
            ElevatedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Print, null); Spacer(Modifier.width(8.dp))
                        Text("Printer", style = MaterialTheme.typography.titleMedium)
                    }
                    Text(
                        if (state.printerConnected) "Connected: ${state.printerName}"
                        else "Not connected — pair your OC8600 in Android Bluetooth settings first",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { pickerOpen = true }) { Text("Pick printer") }
                        if (state.printerConnected) {
                            OutlinedButton(onClick = { svc.disconnectPrinter() }) { Text("Disconnect") }
                        }
                    }
                }
            }

            // Listeners
            ElevatedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Wifi, null); Spacer(Modifier.width(8.dp))
                        Text("WiFi / LAN", style = MaterialTheme.typography.titleMedium)
                    }
                    Text("Device IP: $ip", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = port, onValueChange = { port = it },
                        label = { Text("Port") }, singleLine = true, enabled = !state.tcpOn,
                        modifier = Modifier.width(140.dp),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Switch(
                            checked = state.tcpOn,
                            onCheckedChange = { on ->
                                if (on) svc.startTcp(port.toIntOrNull() ?: 9100)
                                else svc.stopTcp()
                            }
                        )
                        Text(if (state.tcpOn) "Listening on :${state.tcpPort}" else "Off")
                    }

                    HorizontalDivider()

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Bluetooth, null); Spacer(Modifier.width(8.dp))
                        Text("Bluetooth printer mode", style = MaterialTheme.typography.titleMedium)
                    }
                    Text(
                        "Pair WNO POS to THIS phone instead of the OC8600.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Switch(
                            checked = state.btOn,
                            onCheckedChange = { on -> if (on) svc.startBluetoothSpp() else svc.stopBluetoothSpp() }
                        )
                        Text(if (state.btOn) "On" else "Off")
                    }
                }
            }

            // Label settings
            ElevatedCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Label", style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = labelW, onValueChange = { labelW = it }, label = { Text("Width mm") }, modifier = Modifier.weight(1f), singleLine = true)
                        OutlinedTextField(value = labelH, onValueChange = { labelH = it }, label = { Text("Height mm") }, modifier = Modifier.weight(1f), singleLine = true)
                        OutlinedTextField(value = gap, onValueChange = { gap = it }, label = { Text("Gap mm") }, modifier = Modifier.weight(1f), singleLine = true)
                    }
                    Button(onClick = {
                        svc.setLabel(
                            labelW.toIntOrNull() ?: 40,
                            labelH.toIntOrNull() ?: 30,
                            gap.toIntOrNull() ?: 3,
                        )
                    }) { Text("Apply") }
                }
            }

            // Activity log
            ElevatedCard {
                Column(Modifier.padding(16.dp)) {
                    Text("Activity", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    if (state.log.isEmpty()) {
                        Text("No jobs yet.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        LazyColumn(
                            Modifier.heightIn(max = 320.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            items(state.log, key = { it.id }) { entry ->
                                Surface(
                                    tonalElevation = 1.dp,
                                    shape = MaterialTheme.shapes.small,
                                ) {
                                    Column(Modifier.padding(8.dp)) {
                                        Text(
                                            "${entry.source}  ·  in ${entry.bytesIn}B → out ${entry.bytesOut}B",
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                        Text(
                                            entry.lines.joinToString(" | ").ifEmpty { "(no text)" },
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text(
                                            if (entry.ok) "OK" else "ERROR: ${entry.message}",
                                            color = if (entry.ok) MaterialTheme.colorScheme.primary
                                                    else MaterialTheme.colorScheme.error,
                                            style = MaterialTheme.typography.labelSmall,
                                        )
                                    }
                                }
                            }
                        }
                    }
                    if (state.statusLines.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text("Status", style = MaterialTheme.typography.labelLarge)
                        for (s in state.statusLines.take(5)) {
                            Text(s, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }
        }
    }

    if (pickerOpen) {
        val devices: List<BluetoothDevice> = remember { svc.pairedPrinters() }
        AlertDialog(
            onDismissRequest = { pickerOpen = false },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { pickerOpen = false }) { Text("Close") } },
            title = { Text("Paired Bluetooth devices") },
            text = {
                if (devices.isEmpty()) Text("No paired devices found. Pair the OC8600 in Android Bluetooth settings first.")
                else LazyColumn {
                    items(devices, key = { it.address }) { d ->
                        ListItem(
                            headlineContent = { Text(safeName(d) ?: d.address) },
                            supportingContent = { Text(d.address) },
                            modifier = Modifier.clickable {
                                pickerOpen = false
                                scope.launch { svc.connectPrinter(d.address) }
                            }
                        )
                    }
                }
            },
        )
    }
}

private fun safeName(d: BluetoothDevice): String? =
    try { d.name } catch (_: SecurityException) { null }

// Tiny clickable Modifier extension to avoid pulling in foundation just for clickable on this row
@Composable
private fun Modifier.clickable(onClick: () -> Unit): Modifier {
    return androidx.compose.foundation.clickable(onClick = onClick).let { this.then(it) }
}
