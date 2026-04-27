import { useMemo, useState } from "react";
import { ArrowRight, Cpu, FileCode2, Printer, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildTsplStickers,
  extractTextFromEscPos,
  textToStickerLines,
} from "@/lib/escpos-to-tspl";

const Index = () => {
  const [labelW, setLabelW] = useState("40");
  const [labelH, setLabelH] = useState("30");
  const [gap, setGap] = useState("3");
  const [testInput, setTestInput] = useState(
    "Caramel Macchiato\nIced Latte\nFlat White",
  );
  const [hexInput, setHexInput] = useState("");

  const previewTspl = useMemo(
    () =>
      buildTsplStickers(textToStickerLines(testInput), {
        widthMm: Number(labelW) || 40,
        heightMm: Number(labelH) || 30,
        gapMm: Number(gap) || 3,
      }),
    [testInput, labelW, labelH, gap],
  );

  const hexPreview = useMemo(() => {
    const cleaned = hexInput.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
    if (!cleaned || cleaned.length % 2 !== 0) return null;
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    const text = extractTextFromEscPos(bytes);
    const lines = textToStickerLines(text);
    return {
      text,
      lines,
      tspl: buildTsplStickers(lines, {
        widthMm: Number(labelW) || 40,
        heightMm: Number(labelH) || 30,
        gapMm: Number(gap) || 3,
      }),
    };
  }, [hexInput, labelW, labelH, gap]);

  return (
    <div className="min-h-screen bg-gradient-surface">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="container flex items-center gap-3 py-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elevated">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              Sticker Bridge — Converter Reference
            </h1>
            <p className="text-xs text-muted-foreground">
              ESC/POS → TSPL · Officom OC8600 · 40×30 mm gap labels
            </p>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {/* Notice: this is reference only */}
        <Card className="border-primary/40 bg-primary/5 shadow-card">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Cpu className="mt-0.5 h-5 w-5 text-primary" />
              <div className="space-y-1">
                <div className="text-sm font-semibold">
                  This is the conversion reference — the real bridge is a
                  native Kotlin app
                </div>
                <p className="text-xs text-muted-foreground">
                  TCP&nbsp;:9100 listening and Bluetooth SPP server require
                  native Android APIs that a web/Capacitor app cannot use.
                  The full Kotlin Android Studio project lives in{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                    native-android/
                  </code>
                  . Open it in Android Studio and Build APK.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
              >
                <FileCode2 className="h-4 w-4" />
                native-android/README.md
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Label settings */}
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
                  <Input
                    value={labelW}
                    onChange={(e) => setLabelW(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">Height (mm)</Label>
                  <Input
                    value={labelH}
                    onChange={(e) => setLabelH(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs">Gap (mm)</Label>
                  <Input
                    value={gap}
                    onChange={(e) => setGap(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                These match the defaults baked into{" "}
                <code className="rounded bg-muted px-1 py-0.5">TsplBuilder.kt</code>
                . Change them here to preview different label sizes.
              </p>
            </CardContent>
          </Card>

          {/* Drink names → TSPL */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Drink names → TSPL</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                rows={4}
                placeholder="One drink per line"
              />
              <details open className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  TSPL output ({previewTspl.length} bytes)
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
{previewTspl}
                </pre>
              </details>
            </CardContent>
          </Card>
        </div>

        {/* Raw hex test */}
        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Raw ESC/POS hex → extracted text → TSPL
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              rows={3}
              placeholder="1B 40 1B 61 01 4C 61 74 74 65 0A 1D 56 42 00"
              className="font-mono text-xs"
            />
            {hexPreview && (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Extracted text
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-[11px]">
{hexPreview.text || "(empty)"}
                  </pre>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Sticker lines: {hexPreview.lines.length}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    TSPL
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-[11px]">
{hexPreview.tspl || "(none)"}
                  </pre>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Use this to verify the parser handles a real POS payload before
              you compile the Android app.
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Build the Android APK</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              1. Install Android Studio (Hedgehog or newer).
            </p>
            <p>
              2. <strong>File → Open</strong> →
              select the <code className="rounded bg-muted px-1">native-android</code> folder
              from this repo.
            </p>
            <p>
              3. Wait for Gradle sync, then{" "}
              <strong>Build → Build Bundle(s)/APK(s) → Build APK(s)</strong>.
            </p>
            <p>
              4. Install the APK on the POS device, pair the OC8600, and turn
              on the TCP and/or Bluetooth listener.
            </p>
            <p className="pt-2">
              Full instructions:{" "}
              <code className="rounded bg-muted px-1">native-android/README.md</code>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Index;
