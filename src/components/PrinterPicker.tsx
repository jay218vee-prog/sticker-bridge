import { useEffect, useState } from "react";
import { Bluetooth, Loader2, Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { printerService, type PrinterInfo } from "@/lib/printer-service";
import { isNative } from "@/lib/platform";

interface DiscoveredDevice {
  deviceId: string;
  name?: string;
  rssi?: number;
}

interface Props {
  connected: PrinterInfo | null;
  onChange: (p: PrinterInfo | null) => void;
}

export function PrinterPicker({ connected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);

  useEffect(() => {
    if (!open) setDevices([]);
  }, [open]);

  const scan = async () => {
    if (!isNative()) {
      toast.error("Bluetooth scanning needs the Android build", {
        description: "Run this app on Android via Capacitor to discover printers.",
      });
      return;
    }
    setScanning(true);
    setDevices([]);
    try {
      await printerService.scan((d) => {
        setDevices((cur) => {
          if (cur.find((x) => x.deviceId === d.deviceId)) return cur;
          return [...cur, { deviceId: d.deviceId, name: d.name }];
        });
      });
    } catch (e) {
      toast.error("Scan failed", { description: (e as Error).message });
    } finally {
      setScanning(false);
    }
  };

  const connect = async (d: DiscoveredDevice) => {
    setConnecting(d.deviceId);
    try {
      const info = await printerService.connect(d.deviceId, d.name);
      onChange(info);
      toast.success(`Connected to ${d.name ?? d.deviceId}`);
      setOpen(false);
    } catch (e) {
      toast.error("Connection failed", { description: (e as Error).message });
    } finally {
      setConnecting(null);
    }
  };

  const disconnect = async () => {
    await printerService.disconnect();
    onChange(null);
    toast.info("Printer disconnected");
  };

  return (
    <div className="flex items-center gap-2">
      {connected ? (
        <Button variant="outline" size="sm" onClick={disconnect}>
          <Unplug className="mr-2 h-4 w-4" />
          Disconnect
        </Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-gradient-primary text-primary-foreground hover:opacity-90">
              <Plug className="mr-2 h-4 w-4" />
              Connect printer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bluetooth className="h-5 w-5 text-primary" />
                Pair Bluetooth printer
              </DialogTitle>
              <DialogDescription>
                Make sure your Officom OC8600 is powered on and not already paired with the POS.
              </DialogDescription>
            </DialogHeader>
            <Button onClick={scan} disabled={scanning} className="w-full">
              {scanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning…
                </>
              ) : (
                "Scan for devices"
              )}
            </Button>
            <ScrollArea className="mt-3 h-64 rounded-md border">
              {devices.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {scanning ? "Looking for printers…" : "No devices yet. Press scan."}
                </div>
              ) : (
                <ul className="divide-y">
                  {devices.map((d) => (
                    <li key={d.deviceId} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{d.name ?? "Unknown device"}</div>
                        <div className="truncate text-xs text-muted-foreground">{d.deviceId}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={connecting === d.deviceId}
                        onClick={() => connect(d)}
                      >
                        {connecting === d.deviceId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
