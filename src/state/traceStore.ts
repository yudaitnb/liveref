import { create } from "zustand";
import type { TraceLog } from "../trace/types";
import { dummyTrace } from "../trace/dummyTrace";

type TraceState = {
  trace: TraceLog;
  setTrace: (t: TraceLog) => void;
};

export const useTraceStore = create<TraceState>((set) => ({
  trace: dummyTrace,
  setTrace: (t) => set({ trace: t }),
}));
