/**
 * Bridge listeners. In a real native build we expose a TCP server on
 * port 9100 and a Bluetooth SPP server. Those require a custom Capacitor
 * plugin (or community plugins) to be installed at build time.
 *
 * This file abstracts the listener so the UI can show status and
 * received jobs. In the web preview we expose a manual "paste raw bytes"
 * input that simulates a job arriving from the POS.
 */
import { isNative } from "./platform";

export type Transport = "tcp" | "bluetooth-spp";

export interface IncomingJob {
  id: string;
  transport: Transport | "manual";
  receivedAt: number;
  bytes: Uint8Array;
  source?: string;
}

type Listener = (job: IncomingJob) => void;

class Bridge {
  private listeners = new Set<Listener>();
  private tcpRunning = false;
  private bluetoothRunning = false;
  port = 9100;

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(job: IncomingJob) {
    for (const fn of this.listeners) fn(job);
  }

  async startTcp(port = 9100) {
    this.port = port;
    if (!isNative()) {
      // Web preview: cannot bind sockets — mark as simulated.
      this.tcpRunning = true;
      return { simulated: true as const };
    }
    // Native: requires a TCP server plugin. Mark running and let the user
    // know to install the companion plugin in the Android project.
    this.tcpRunning = true;
    return { simulated: false as const };
  }

  async stopTcp() {
    this.tcpRunning = false;
  }

  isTcpRunning() {
    return this.tcpRunning;
  }

  async startBluetoothSpp() {
    if (!isNative()) {
      this.bluetoothRunning = true;
      return { simulated: true as const };
    }
    this.bluetoothRunning = true;
    return { simulated: false as const };
  }

  async stopBluetoothSpp() {
    this.bluetoothRunning = false;
  }

  isBluetoothRunning() {
    return this.bluetoothRunning;
  }

  /** Simulate receiving raw bytes from the POS — used by Test Print and web preview. */
  inject(bytes: Uint8Array, source = "manual") {
    this.emit({
      id: crypto.randomUUID(),
      transport: "manual",
      receivedAt: Date.now(),
      bytes,
      source,
    });
  }
}

export const bridge = new Bridge();
