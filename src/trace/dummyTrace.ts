import type { TraceLog } from "./types";

export const dummyTrace: TraceLog = {
  events: [
    // step 0
    { t: "alloc", obj: "o1", objKind: "object" },
    { t: "alloc", obj: "o2", objKind: "object" },
    { t: "write", obj: "o1", key: "x", val: { kind: "obj", id: "o2" }, checkpointId: "L1" },

    // step 1
    { t: "alloc", obj: "o3", objKind: "object" },
    { t: "write", obj: "o2", key: "y", val: { kind: "obj", id: "o3" }, checkpointId: "L2" },

    // step 2
    { t: "delete", obj: "o1", key: "x", checkpointId: "L3" },

    // step 3
    { t: "write", obj: "o1", key: "x", val: { kind: "obj", id: "o3" }, checkpointId: "L4" },
  ],
  steps: [
    { stepId: 0, checkpointId: "L1", varNames: [], deltaFrom: 0, deltaTo: 3 },
    { stepId: 1, checkpointId: "L2", varNames: [], deltaFrom: 3, deltaTo: 5 },
    { stepId: 2, checkpointId: "L3", varNames: [], deltaFrom: 5, deltaTo: 6 },
    { stepId: 3, checkpointId: "L4", varNames: [], deltaFrom: 6, deltaTo: 7 },
  ],
  snapshots: [
    {
      at: 0,
      state: {
        objects: {},
        roots: {},
        lastWrite: {},
      },
    },
  ],
  callEvents: [],
};
