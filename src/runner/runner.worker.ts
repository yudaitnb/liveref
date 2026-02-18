import * as Comlink from "comlink";
import type { RunnerApi, RunnerOptions, RunResult, LogEntry, LogLevel } from "./runnerTypes";
import type { LocId } from "../trace/types";
import { TraceRecorder } from "./traceRecorder";
import { instrument } from "./instrument";

function safeSerialize(value: any, maxDepth = 4): any {
  const seen = new WeakSet<object>();

  const walk = (v: any, depth: number): any => {
    if (depth > maxDepth) return "[MaxDepth]";
    if (v === null) return null;

    const t = typeof v;
    if (t === "undefined" || t === "number" || t === "string" || t === "boolean" || t === "bigint") return v;
    if (t === "function") return `[Function ${v.name || "anonymous"}]`;
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };

    if (t === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
      if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));

      const out: Record<string, any> = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k], depth + 1);
      return out;
    }

    return String(v);
  };

  try {
    return walk(value, 0);
  } catch {
    return "[Unserializable]";
  }
}

const api: RunnerApi = {
  async run(code: string, opts?: RunnerOptions): Promise<RunResult> {
    const logs: LogEntry[] = [];
    const push = (level: LogLevel, args: any[]) => {
      logs.push({ level, args: args.map((a) => safeSerialize(a)), ts: Date.now() });
    };

    // console proxy
    const consoleProxy: Console = {
      log: (...args: any[]) => push("log", args),
      info: (...args: any[]) => push("info", args),
      warn: (...args: any[]) => push("warn", args),
      error: (...args: any[]) => push("error", args),
    } as any;

    const oldConsole = (globalThis as any).console;
    (globalThis as any).console = consoleProxy;

    // === trace runtime ===
    const rec = new TraceRecorder(opts?.snapshotEveryNSteps ?? 50);

    // expose minimal tracing API for now (Babel later auto-inserts these calls)
    const g: any = globalThis;

    const oldTrace = g.__trace;
    const oldVal = g.__val;
    const oldWrite = g.__writeProp;
    const oldDel = g.__deleteProp;
    const oldRoot = g.__setVar;

    g.__trace = (locId?: LocId) => rec.traceStep(locId);

    g.__val = (v: any) => {
      // ensure obj ids for objects/functions
      rec.toValueRef(v);
      return v;
    };

    g.__writeProp = (base: any, key: any, val: any, locId?: LocId) => {
      // evaluate once
      const k = String(key);
      const baseRef = rec.toValueRef(base);
      const valRef = rec.toValueRef(val);
      if (baseRef.kind === "obj") {
        rec.write(baseRef.id, k, valRef, locId);
      }
      // perform real write
      try {
        base[k] = val;
      } catch {
        // ignore in MVP
      }
      return val;
    };

    g.__deleteProp = (base: any, key: any, locId?: LocId) => {
      const k = String(key);
      const baseRef = rec.toValueRef(base);
      if (baseRef.kind === "obj") {
        rec.del(baseRef.id, k, locId);
      }
      try {
        delete base[k];
      } catch {
        return false;
      }
    };

    g.__setVar = (name: string, val: any, locId?: LocId) => {
      const ref = rec.toValueRef(val);
      rec.rootSet(String(name), ref, locId);
      return val;
    };

    try {
      const compiled = instrument(code);
      const fn = new Function(`"use strict";\n${compiled}\n`);
      const result = fn();

      // program end boundary (見やすくするため)
      rec.traceStep("__end__");

      return { ok: true, logs, result: safeSerialize(result), trace: rec.trace };
    } catch (e: any) {
      const err = e instanceof Error ? e : new Error(String(e));
      // 例外でも trace は返す
      rec.traceStep("__end__");
      return {
        ok: false,
        logs,
        error: { name: err.name, message: err.message, stack: err.stack },
        trace: rec.trace,
      };
    } finally {
      // restore globals
      (globalThis as any).console = oldConsole;
      g.__trace = oldTrace;
      g.__val = oldVal;
      g.__writeProp = oldWrite;
      g.__deleteProp = oldDel;
      g.__setVar = oldRoot;
    }
  },
};

Comlink.expose(api);
