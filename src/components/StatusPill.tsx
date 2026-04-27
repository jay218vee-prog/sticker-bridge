import { cn } from "@/lib/utils";

type Status = "online" | "offline" | "warning";

interface Props {
  status: Status;
  label: string;
  detail?: string;
}

const colorMap: Record<Status, string> = {
  online: "bg-success text-success",
  offline: "bg-muted-foreground/40 text-muted-foreground",
  warning: "bg-warning text-warning",
};

export function StatusPill({ status, label, detail }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-card">
      <span className="relative flex h-2.5 w-2.5">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-60",
            status === "online" && "animate-ping bg-success",
          )}
        />
        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", colorMap[status].split(" ")[0])} />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium leading-tight">{label}</div>
        {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}
