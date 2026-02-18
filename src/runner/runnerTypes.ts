import type { TraceLog } from "../trace/types";

export type LogLevel = "log" | "info" | "warn" | "error";
export type LogEntry = { level: LogLevel; args: any[]; ts: number };

export type RunOk = { ok: true; logs: LogEntry[]; result: any; trace: TraceLog };
export type RunErr = {
  ok: false;
  logs: LogEntry[];
  error: { name: string; message: string; stack?: string };
  trace: TraceLog;
};
export type RunResult = RunOk | RunErr;

export type RunnerOptions = {
  snapshotEveryNSteps?: number; // 例: 50
};

export type RunnerApi = {
  run: (code: string, opts?: RunnerOptions) => Promise<RunResult>;
};
