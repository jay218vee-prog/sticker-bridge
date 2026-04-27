import { BleClient, type BleDevice } from "@capacitor-community/bluetooth-le";
import { isNative } from "./platform";

/**
 * Officom OC8600 (and most TSPL/ESC-POS bluetooth thermal printers) expose
 * a Nordic UART-style write characteristic. We try the common ones and
 * fall back to enumerating writable characteristics.
 */
const KNOWN_PRINTER_SERVICES = [
  // Nordic UART
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  // Common Chinese thermal printer service
  "0000ff00-0000-1000-8000-00805f9b34fb",
  // Generic SPP-over-BLE service
  "000018f0-0000-1000-8000-00805f9b34fb",
];

const KNOWN_WRITE_CHARS = [
  "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART RX
  "0000ff02-0000-1000-8000-00805f9b34fb",
  "00002af1-0000-1000-8000-00805f9b34fb",
];

export interface PrinterInfo {
  deviceId: string;
  name?: string;
  serviceUuid: string;
  characteristicUuid: string;
}

let connected: PrinterInfo | null = null;

export const printerService = {
  isNative,

  async ensureReady() {
    if (!isNative()) throw new Error("Bluetooth requires the native Android app.");
    await BleClient.initialize({ androidNeverForLocation: true });
  },

  async scan(onDevice: (d: BleDevice) => void, timeoutMs = 8000) {
    await this.ensureReady();
    await BleClient.requestLEScan({ allowDuplicates: false }, (result) => {
      onDevice(result.device);
    });
    await new Promise((r) => setTimeout(r, timeoutMs));
    await BleClient.stopLEScan();
  },

  async connect(deviceId: string, name?: string): Promise<PrinterInfo> {
    await this.ensureReady();
    await BleClient.connect(deviceId, () => {
      connected = null;
    });

    const services = await BleClient.getServices(deviceId);

    // Try known service+characteristic combos first
    for (const svc of services) {
      const matchedSvc = KNOWN_PRINTER_SERVICES.find(
        (s) => s.toLowerCase() === svc.uuid.toLowerCase(),
      );
      for (const ch of svc.characteristics) {
        const matchedCh = KNOWN_WRITE_CHARS.find(
          (c) => c.toLowerCase() === ch.uuid.toLowerCase(),
        );
        if (matchedSvc && matchedCh) {
          connected = {
            deviceId,
            name,
            serviceUuid: svc.uuid,
            characteristicUuid: ch.uuid,
          };
          return connected;
        }
      }
    }

    // Fallback: pick the first writable characteristic
    for (const svc of services) {
      for (const ch of svc.characteristics) {
        if (ch.properties.write || ch.properties.writeWithoutResponse) {
          connected = {
            deviceId,
            name,
            serviceUuid: svc.uuid,
            characteristicUuid: ch.uuid,
          };
          return connected;
        }
      }
    }

    await BleClient.disconnect(deviceId);
    throw new Error("No writable characteristic found on this device.");
  },

  current(): PrinterInfo | null {
    return connected;
  },

  async disconnect() {
    if (!connected) return;
    try {
      await BleClient.disconnect(connected.deviceId);
    } finally {
      connected = null;
    }
  },

  /**
   * Send raw bytes (TSPL or anything) in chunks. BLE MTU defaults to ~20 bytes;
   * we use 180 to be safe on most modern stacks (Android negotiates higher MTU).
   */
  async sendRaw(data: Uint8Array, chunkSize = 180) {
    if (!connected) throw new Error("Printer not connected.");
    const { deviceId, serviceUuid, characteristicUuid } = connected;
    for (let i = 0; i < data.length; i += chunkSize) {
      const slice = data.slice(i, i + chunkSize);
      const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
      await BleClient.writeWithoutResponse(deviceId, serviceUuid, characteristicUuid, view);
    }
  },

  async sendText(text: string) {
    await this.sendRaw(new TextEncoder().encode(text));
  },
};
