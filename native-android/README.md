# Sticker Bridge — Native Android (Kotlin)

A real native Android bridge that:

1. **Receives** ESC/POS print jobs from WNO POS over **WiFi/LAN (TCP :9100)** and **Bluetooth Classic SPP** (the app advertises itself as a Bluetooth printer).
2. **Converts** ESC/POS → **TSPL** (40×30 mm gap-sensor labels).
3. **Forwards** the TSPL to your **Officom OC8600** over **Bluetooth Classic SPP**.

> Lovable cannot build native Android projects — these files are a complete spec. Copy the `native-android/` folder into a fresh Android Studio project (or open it directly), then **Build → Build APK**.

---

## What's in this folder

```
native-android/
├── README.md                       ← this file
├── settings.gradle.kts
├── build.gradle.kts                ← root
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── res/
        │   ├── values/strings.xml
        │   ├── values/themes.xml
        │   └── xml/network_security_config.xml
        └── java/com/stickerbridge/
            ├── MainActivity.kt              ← Jetpack Compose UI
            ├── BridgeService.kt             ← Foreground service hosting the listeners
            ├── transport/
            │   ├── TcpListener.kt           ← ServerSocket(9100)
            │   └── BtSppServer.kt           ← BluetoothServerSocket (SPP)
            ├── printer/
            │   └── PrinterClient.kt         ← BluetoothSocket → OC8600
            ├── convert/
            │   ├── EscPosParser.kt          ← strip ESC/POS control bytes
            │   └── TsplBuilder.kt           ← build TSPL for 40×30 gap labels
            └── ui/
                ├── BridgeViewModel.kt
                └── theme/Theme.kt
```

---

## Open in Android Studio

### Option A — open this folder directly

1. **Install Android Studio** (Hedgehog or newer).
2. **File → Open** → select the `native-android` folder.
3. Let Gradle sync (downloads the Android SDK + dependencies on first run).
4. Plug in your Android POS device with **USB debugging on**, or pick an emulator.
5. Click ▶ **Run 'app'**.

### Option B — start a fresh project, then drop the files in

1. Android Studio → **New Project → Empty Activity (Compose)**, package `com.stickerbridge`, min SDK 26.
2. Replace the generated files with the ones in `native-android/app/src/main/`.
3. Replace the app `build.gradle.kts` with the one here.
4. Sync, then Run.

### Build the APK

**Build → Build Bundle(s)/APK(s) → Build APK(s)**.
Find the APK at `app/build/outputs/apk/debug/app-debug.apk` and install it on the POS.

---

## How to wire up your POS

After installing & opening the app on the POS device:

1. **Pair the OC8600** with the POS device's Bluetooth (Android Settings → Bluetooth → pair).
2. In the app, tap **Pick printer** and choose the OC8600. Tap **Connect**.
3. Choose your POS transport:
   - **WiFi/LAN**: toggle **TCP listener** on. The app shows the device's IP. In WNO POS, configure the printer as **Network printer** with that IP and port `9100`.
   - **Bluetooth SPP**: toggle **Bluetooth printer mode** on. The phone now appears as a printer to other Bluetooth devices. Pair WNO POS to **this phone** (not the OC8600) and select it as the printer.
4. Press a test print in WNO POS. The app's **Activity** log shows the incoming bytes, the parsed drink names, and the outgoing TSPL.

---

## Permissions the app requests

- `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE` (Android 12+)
- `BLUETOOTH`, `BLUETOOTH_ADMIN` (legacy, ≤ Android 11)
- `ACCESS_FINE_LOCATION` (required by Android for BT scanning ≤ 11)
- `INTERNET`, `ACCESS_NETWORK_STATE` (TCP listener)
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS` (keep listeners alive)

---

## Notes / gotchas

- **TCP port 9100**: standard raw printing port. If `bind()` fails, another app is using it — change the port in `BridgeService.kt`.
- **SPP server UUID**: uses the standard SPP UUID `00001101-0000-1000-8000-00805F9B34FB` so generic "Bluetooth printer" drivers on POS apps will recognise it.
- **OC8600 is Bluetooth Classic** (not BLE) — `PrinterClient.kt` uses `BluetoothSocket`, not `BluetoothGatt`.
- The foreground service is **mandatory** — without it Android will kill your TCP/SPP listeners after the screen turns off.
- The conversion logic is a Kotlin port of the unit-tested TypeScript version in `src/lib/escpos-to-tspl.ts` — same behaviour, same edge cases.
