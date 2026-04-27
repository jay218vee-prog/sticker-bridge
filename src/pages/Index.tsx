import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bluetooth, Printer, Radio, Sparkles, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ActivityLog } from "@/components/ActivityLog";
import { PrinterPicker } from "@/components/PrinterPicker";
import { StatusPill } from "@/components/StatusPill";
import { bridge } from "@/lib/bridge";
import {
  buildTsplStickers,
  escPosToTspl,
  extractTextFromEscPos,
  textToStickerLines,
} from "@/lib/escpos-to-tspl";
import { isNative } from "@/lib/platform";
import { printerService, type PrinterInfo } from "@/lib/printer-service";
import type { LogEntry } from "@/types/bridge";

const BridgePage = () => {
  const [printer, setPrinter] = useState<PrinterInfo | null>(printerService.current());
  const [tcpOn, setTcpOn] = useState(false);
  const [btOn, setBtOn] = useState(false);
  const [port, setPort] = useState("9100");
  const [labelW, setLabelW] = useState("40");
  const [labelH, setLabelH] = useState("30");
  const [gap, setGap] = useState("3");
  const [autoPrint, setAutoPrint] = useState(true);
  const [testInput, setTestInput] = useState("Caramel Macchiato\nIced Latte\nFlat White");
  const [hexInput, setHexInput] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const printerRef = useRef(printer);
  const autoPrintRef = useRef(autoPrint);
  const dimsRef = useRef({ labelW, labelH, gap });

  useEffect(() => {
    printerRef.current = printer;
  }, [printer]);
  useEffect(() => {
    autoPrintRef.current = autoPrint;
  }, [autoPrint]);
  useEffect(() => {
    dimsRef.current = { labelW, labelH, gap };
  }, [labelW, labelH, gap]);

  // Wire bridge → converter → printer
  useEffect(() => {
    const off = bridge.on(async (job) => {
      const text = extractTextFromEscPos(job.bytes);
      const lines = textToStickerLines(text);
      const dims = dimsRef.current;
      const tspl = buildTsplStickers(lines, {
        widthMm: Number(dims.labelW) || 40,
        heightMm: Number(dims.labelH) || 30,
        gapMm: Number(dims.gap) || 3,
      });
      const tsplBytes = new TextEncoder().encode(tspl);

      const entry: LogEntry = {
        id: job.id,
        transport: job.transport,
        receivedAt: job.receivedAt,
        bytesIn: job.bytes.length,
        bytesOut: tsplBytes.length,
        lines,
        status: "pending",
      };
      setLog((cur) => [entry, ...cur].slice(0, 50));

      if (!autoPrintRef.current || !printerRef.current) {
        setLog((cur) =>
          cur.map((e) =>
            e.id === entry.id
              ? { ...e, status: printerRef.current ? "ok" : "error", error: printerRef.current ? undefined : "Printer not connected — auto-print off or no printer" }
              : e,
          ),
        );
        return;
      }

      try {
        await printerService.sendRaw(tsplBytes);
        setLog((cur) => cur.map((e) => (e.id === entry.id ? { ...e, status: "ok" } : e)));
      } catch (e) {
        const msg = (e as Error).message;
        setLog((cur) => cur.map((x) => (x.id === entry.id ? { ...x, status: "error", error: msg } : x)));
        toast.error("Print failed", { description: msg });
      }
    });
    return () => {
      off();
    };
  }, []);

  const toggleTcp = async (on: boolean) => {
    if (on) {
      const r = await bridge.startTcp(Number(port) || 9100);
      setTcpOn(true);
      if (r.simulated) {
        toast.info("TCP listener (simulated)", {
          description: "Real socket binding only works in the Android build.",
        });
      } else {
        toast.success(`Listening on TCP :${port}`);
      }
    } else {
      await bridge.stopTcp();
      setTcpOn(false);
    }
  };

  const toggleBt = async (on: boolean) => {
    if (on) {
      const r = await bridge.startBluetoothSpp();
      setBtOn(true);
      if (r.simulated) {
        toast.info("Bluetooth SPP (simulated)", {
          description: "Real SPP server requires the Android build.",
        });
      } else {
        toast.success("Bluetooth SPP listener started");
      }
    } else {
      await bridge.stopBluetoothSpp();
      setBtOn(false);
    }
  };

  const sendTest = () => {
    // Build a realistic ESC/POS payload: init + center + double + text + cut
    const enc = new TextEncoder();
    const parts: number[] = [];
    parts.push(0x1b, 0x40); // ESC @
    parts.push(0x1b, 0x61, 0x01); // center
    parts.push(0x1d, 0x21, 0x11); // size 2x
    for (const b of enc.encode(testInput + "\n")) parts.push(b);
    parts.push(0x1d, 0x56, 0x42, 0x00); // cut
    bridge.inject(new Uint8Array(parts), "test");
  };

  const sendHex = () => {
    const cleaned = hexInput.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
    if (cleaned.length === 0) {
      toast.error("Paste hex bytes first");
      return;
    }
    if (cleaned.length % 2 !== 0) {
      toast.error("Hex string has odd length");
      return;
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    bridge.inject(bytes, "hex");
  };

  const previewTspl = useMemo(() => {
    return buildTsplStickers(textToStickerLines(testInput), {
      widthMm: Number(labelW) || 40,
      heightMm: Number(labelH) || 30,
      gapMm: Number(gap) || 3,
    });
  }, [testInput, labelW, labelH, gap]);

  return (
    <div className="min-h-screen bg-gradient-surface">
      {/* Header */}
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="container flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elevated">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Sticker Bridge</h1>
              <p className="text-xs text-muted-foreground">ESC/POS → TSPL · Officom OC8600</p>
            </div>
          </div>
          <PrinterPicker connected={printer} onChange={setPrinter} />
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {/* Status row */}
        <div className="grid gap-3 md:grid-cols-3">
          <StatusPill
            status={printer ? "online" : "offline"}
            label={printer ? "Printer connected" : "Printer disconnected"}
            detail={printer?.name ?? printer?.deviceId ?? "Pair your OC8600 over Bluetooth"}
          />
          <StatusPill
            status={tcpOn ? "online" : "offline"}
            label={tcpOn ? `TCP listener · :${port}` : "TCP listener off"}
            detail="Point POS WiFi/LAN printer to this device's IP"
          />
          <StatusPill
            status={btOn ? "online" : "offline"}
            label={btOn ? "Bluetooth SPP on" : "Bluetooth SPP off"}
            detail="POS pairs to this app instead of the printer"
          />
        </div>

        {!isNative() && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            <strong className="text-warning">Web preview mode.</strong>{" "}
            <span className="text-foreground/80">
              Bluetooth and TCP listeners are simulated here. Build the Android app via Capacitor to
              receive real POS jobs and print to the OC8600.
            </span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          {/* Left: configuration */}
          <div className="space-y-6">
            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-4 w-4 text-primary" /> POS listeners
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Wifi className="h-4 w-4" /> WiFi / LAN (recommended)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      App listens on a TCP port. In WNO POS, set the printer to network mode with
                      this device's IP and the port below.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Label htmlFor="port" className="text-xs">
                        Port
                      </Label>
                      <Input
                        id="port"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        className="h-8 w-24"
                        disabled={tcpOn}
                      />
                    </div>
                  </div>
                  <Switch checked={tcpOn} onCheckedChange={toggleTcp} />
                </div>

                <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Bluetooth className="h-4 w-4" /> Bluetooth SPP
                    </div>
                    <p className="text-xs text-muted-foreground">
                      App pretends to be a Bluetooth printer. Pair WNO POS to this device instead of
                      the OC8600.
                    </p>
                  </div>
                  <Switch checked={btOn} onCheckedChange={toggleBt} />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Printer className="h-4 w-4 text-primary" /> Label settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Width (mm)</Label>
                    <Input value={labelW} onChange={(e) => setLabelW(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Height (mm)</Label>
                    <Input value={labelH} onChange={(e) => setLabelH(e.target.value)} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Gap (mm)</Label>
                    <Input value={gap} onChange={(e) => setGap(e.target.value)} className="h-9" />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Auto-print incoming jobs</div>
                    <p className="text-xs text-muted-foreground">
                      Off = jobs are converted and logged but not sent to the printer.
                    </p>
                  </div>
                  <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" /> Test
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="text">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="text">Drink names</TabsTrigger>
                    <TabsTrigger value="hex">Raw hex</TabsTrigger>
                  </TabsList>
                  <TabsContent value="text" className="space-y-3 pt-3">
                    <Textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={4}
                      placeholder="One drink per line"
                    />
                    <Button onClick={sendTest} className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90">
                      Simulate POS job
                    </Button>
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">Preview TSPL output</summary>
                      <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
{previewTspl}
                      </pre>
                    </details>
                  </TabsContent>
                  <TabsContent value="hex" className="space-y-3 pt-3">
                    <Textarea
                      value={hexInput}
                      onChange={(e) => setHexInput(e.target.value)}
                      rows={4}
                      placeholder="1B 40 1B 61 01 4C 61 74 74 65 0A 1D 56 42 00"
                      className="font-mono text-xs"
                    />
                    <Button onClick={sendHex} variant="secondary" className="w-full">
                      Inject bytes
                    </Button>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Right: activity */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Activity className="h-4 w-4 text-primary" /> Activity
              </h2>
              {log.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setLog([])}>
                  Clear
                </Button>
              )}
            </div>
            <ActivityLog entries={log} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default BridgePage;
