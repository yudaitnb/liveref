import { create } from "zustand";
import type { TraceLog } from "../trace/types";

export const emptyTrace: TraceLog = {
  steps: [{ stepId: 0, checkpointId: "__init__", varNames: [], deltaFrom: 0, deltaTo: 0 }],
  events: [],
  snapshots: [{ at: 0, state: { objects: {}, roots: {}, lastWrite: {} } }],
  callEvents: [],
};

type TraceState = {
  trace: TraceLog;
  setTrace: (t: TraceLog) => void;
  resetTrace: () => void;
};

export const useTraceStore = create<TraceState>((set) => ({
  trace: emptyTrace,
  setTrace: (t) => set({ trace: t }),
  resetTrace: () => set({ trace: emptyTrace }),
}));
