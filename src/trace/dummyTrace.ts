import type { TraceLog } from "./types";

export const dummyTrace: TraceLog = {
  events: [
    // step 0
    { t: "alloc", obj: "o1", objKind: "object" },
    { t: "alloc", obj: "o2", objKind: "object" },
    { t: "write", obj: "o1", key: "x", val: { kind: "obj", id: "o2" }, locId: "L1" },

    // step 1
    { t: "alloc", obj: "o3", objKind: "object" },
    { t: "write", obj: "o2", key: "y", val: { kind: "obj", id: "o3" }, locId: "L2" },

    // step 2
    { t: "delete", obj: "o1", key: "x", locId: "L3" },

    // step 3
    { t: "write", obj: "o1", key: "x", val: { kind: "obj", id: "o3" }, locId: "L4" },
  ],
  steps: [
    { stepId: 0, locId: "L1", deltaFrom: 0, deltaTo: 3 },
    { stepId: 1, locId: "L2", deltaFrom: 3, deltaTo: 5 },
    { stepId: 2, locId: "L3", deltaFrom: 5, deltaTo: 6 },
    { stepId: 3, locId: "L4", deltaFrom: 6, deltaTo: 7 },
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
};
