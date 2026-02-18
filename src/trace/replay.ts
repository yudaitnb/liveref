// src/trace/replay.ts
import type { DeltaEvent, HeapState, Snapshot, StepId, TraceLog, ValueRef } from "./types";

function cloneState(s: HeapState): HeapState {
  return JSON.parse(JSON.stringify(s)) as HeapState;
}

function lastWriteKey(obj: string, key: string) {
  return `${obj}:${key}`;
}

// ★追加
function rootWriteKey(name: string) {
  return `root:${name}`;
}

function applyEvent(state: HeapState, e: DeltaEvent, stepId: StepId) {
  switch (e.t) {
    case "alloc": {
      if (!state.objects[e.obj]) {
        state.objects[e.obj] = { id: e.obj, objKind: e.objKind, className: e.className, props: {} };
      }
      return;
    }
    case "write": {
      const o = state.objects[e.obj];
      if (!o) return;
      o.props[e.key] = e.val as ValueRef;
      state.lastWrite[lastWriteKey(e.obj, e.key)] = { stepId, checkpointId: e.checkpointId };
      return;
    }
    case "delete": {
      const o = state.objects[e.obj];
      if (!o) return;
      delete o.props[e.key];
      state.lastWrite[lastWriteKey(e.obj, e.key)] = { stepId, checkpointId: e.checkpointId };
      return;
    }

    // ★追加
    case "rootSet": {
      state.roots[e.name] = e.val as ValueRef;
      state.lastWrite[rootWriteKey(e.name)] = { stepId, checkpointId: e.checkpointId };
      return;
    }
    case "rootDel": {
      delete state.roots[e.name];
      state.lastWrite[rootWriteKey(e.name)] = { stepId, checkpointId: e.checkpointId };
      return;
    }
  }
}

function findSnapshot(trace: TraceLog, stepId: StepId): Snapshot {
  let best = trace.snapshots[0];
  for (const s of trace.snapshots) {
    if (s.at <= stepId && s.at >= best.at) best = s;
  }
  return best;
}

export function getStateAt(trace: TraceLog, stepId: StepId): HeapState {
  const snap = findSnapshot(trace, stepId);
  const state = cloneState(snap.state);

  for (let s = snap.at; s <= stepId; s++) {
    const meta = trace.steps[s];
    if (!meta) continue;
    for (let i = meta.deltaFrom; i < meta.deltaTo; i++) {
      applyEvent(state, trace.events[i], s);
    }
  }
  return state;
}
