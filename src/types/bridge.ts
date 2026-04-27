export type JobStatus = "ok" | "error" | "pending";

export interface LogEntry {
  id: string;
  transport: string;
  receivedAt: number;
  bytesIn: number;
  bytesOut: number;
  lines: string[];
  status: JobStatus;
  error?: string;
}
