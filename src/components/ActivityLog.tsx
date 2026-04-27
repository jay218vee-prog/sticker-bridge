import { ArrowRight, FileText, Printer } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { LogEntry } from "@/types/bridge";

interface Props {
  entries: LogEntry[];
}

export function ActivityLog({ entries }: Props) {
  return (
    <ScrollArea className="h-[420px] rounded-lg border bg-card shadow-card">
      {entries.length === 0 ? (
        <div className="flex h-[420px] flex-col items-center justify-center gap-2 p-8 text-center">
          <Printer className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-sm text-muted-foreground">No print jobs yet.</div>
          <div className="text-xs text-muted-foreground/70">
            Send an order from your POS or run a test print.
          </div>
        </div>
      ) : (
        <ul className="divide-y">
          {entries.map((e) => (
            <li key={e.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {e.transport}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.receivedAt).toLocaleTimeString()}
                  </span>
                </div>
                <Badge
                  variant={e.status === "ok" ? "default" : e.status === "error" ? "destructive" : "secondary"}
                  className={e.status === "ok" ? "bg-success text-success-foreground hover:bg-success" : ""}
                >
                  {e.status}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> ESC/POS in
                  </div>
                  <div className="text-sm">
                    {e.lines.length === 0 ? (
                      <span className="italic text-muted-foreground">empty</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {e.lines.map((l, i) => (
                          <li key={i} className="font-medium">
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">{e.bytesIn} bytes</div>
                </div>

                <ArrowRight className="mt-6 h-4 w-4 text-muted-foreground" />

                <div className="rounded-md border bg-primary/5 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Printer className="h-3.5 w-3.5" /> TSPL out
                  </div>
                  <div className="text-sm font-medium">
                    {e.lines.length} sticker{e.lines.length === 1 ? "" : "s"}
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">{e.bytesOut} bytes</div>
                  {e.error && (
                    <div className="mt-2 text-xs text-destructive">{e.error}</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}
