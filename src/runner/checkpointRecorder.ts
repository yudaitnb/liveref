import type {
  DeltaEvent,
  HeapState,
  CheckpointId,
  ObjId,
  StepId,
  StepMeta,
  TraceLog,
  ValueRef,
} from "../trace/types";

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function lwKey(obj: ObjId, key: string) {
  return `${obj}:${key}`;
}

function rootWriteKey(name: string) {
  return `root:${name}`;
}

export class CheckpointRecorder {
  private stepId: StepId = 0;
  private stepStartEventIndex = 0;

  private readonly snapshotEvery: number;

  private readonly state: HeapState = {
    objects: {},
    roots: {},
    lastWrite: {},
  };

  readonly trace: TraceLog = {
    steps: [],
    events: [],
    snapshots: [],
    callEvents: [],
  };

  private callIdSeq = 1;

  constructor(snapshotEveryNSteps: number) {
    this.snapshotEvery = Math.max(1, snapshotEveryNSteps);
    // 初期スナップショット（step 0 の前提点）
    this.trace.snapshots.push({ at: 0, state: deepClone(this.state) });
    // UIのsliderが壊れないように最低1step用意（checkpointIdは後で上書きされても良い）
    this.trace.steps.push({ stepId: 0, checkpointId: "__init__", varNames: [], deltaFrom: 0, deltaTo: 0 });
  }

  // === value/id ===
  private objIdMap = new WeakMap<object, ObjId>();
  private objIdSeq = 1;

  ensureObjId(
    o: object,
    kind: "object" | "array" | "function" | "class",
    className?: string
  ): ObjId {
    let id = this.objIdMap.get(o);
    if (!id) {
      id = `o${this.objIdSeq++}`;
      this.objIdMap.set(o, id);
      this.alloc(id, kind, className);
    }
    return id;
  }

  toValueRef(v: any): ValueRef {
    const t = typeof v;
    if (v === null) return { kind: "prim", v: null };
    if (t === "undefined" || t === "number" || t === "string" || t === "boolean" || t === "bigint") {
      return { kind: "prim", v };
    }
    if (t === "function") {
      const fnName = typeof v.name === "string" && v.name ? v.name : "Function";
      const fnSrc = Function.prototype.toString.call(v);
      const isClassCtor = /^class\b/.test(fnSrc);
      return { kind: "obj", id: this.ensureObjId(v, isClassCtor ? "class" : "function", fnName) };
    }
    if (t === "object") {
      if (Array.isArray(v)) return { kind: "obj", id: this.ensureObjId(v, "array", "Array") };
      const ctorName =
        typeof (v as any)?.constructor?.name === "string" && (v as any).constructor.name
          ? (v as any).constructor.name
          : "Object";
      // Instance objects are still "object"; class constructors are represented in the function branch.
      return { kind: "obj", id: this.ensureObjId(v, "object", ctorName) };
    }
    return { kind: "prim", v: String(v) };
  }

  // === delta emit + apply ===
  private pushEvent(e: DeltaEvent) {
    this.trace.events.push(e);
  }

  alloc(
    obj: ObjId,
    objKind: "object" | "array" | "function" | "class",
    className?: string
  ) {
    if (!this.state.objects[obj]) {
      this.state.objects[obj] = { id: obj, objKind, className, props: {} };
    }
    this.pushEvent({ t: "alloc", obj, objKind, className });
  }

  write(obj: ObjId, key: string, val: ValueRef, checkpointId?: CheckpointId) {
    const o = this.state.objects[obj];
    if (!o) return;
    o.props[key] = val;
    this.state.lastWrite[lwKey(obj, key)] = { stepId: this.stepId, checkpointId };
    this.pushEvent({ t: "write", obj, key, val, checkpointId });
  }

  del(obj: ObjId, key: string, checkpointId?: CheckpointId) {
    const o = this.state.objects[obj];
    if (!o) return;
    delete o.props[key];
    this.state.lastWrite[lwKey(obj, key)] = { stepId: this.stepId, checkpointId };
    this.pushEvent({ t: "delete", obj, key, checkpointId });
  }

  rootSet(name: string, val: ValueRef, checkpointId?: CheckpointId) {
    this.state.roots[name] = val;
    this.state.lastWrite[rootWriteKey(name)] = { stepId: this.stepId, checkpointId }; // ★追加
    this.pushEvent({ t: "rootSet", name, val, checkpointId });
  }

  rootDel(name: string, checkpointId?: CheckpointId) {
    delete this.state.roots[name];
    this.state.lastWrite[rootWriteKey(name)] = { stepId: this.stepId, checkpointId }; // ★追加
    this.pushEvent({ t: "rootDel", name, checkpointId });
  }

  // === step boundary ===
  checkpointStep(checkpointId?: CheckpointId) {
    const varNames = Object.keys(this.state.roots).sort();
    // 既に step 0 のダミーがあるので、最初の checkpointStep は step 0 を上書き
    const meta: StepMeta = {
      stepId: this.stepId,
      checkpointId,
      varNames,
      deltaFrom: this.stepStartEventIndex,
      deltaTo: this.trace.events.length,
    };

    if (this.stepId === 0 && this.trace.steps.length === 1 && this.trace.steps[0].checkpointId === "__init__") {
      this.trace.steps[0] = meta;
    } else {
      this.trace.steps.push(meta);
    }

    // snapshot（固定間隔）
    if ((this.stepId + 1) % this.snapshotEvery === 0) {
      this.trace.snapshots.push({ at: this.stepId, state: deepClone(this.state) });
    }

    this.stepId += 1;
    this.stepStartEventIndex = this.trace.events.length;
  }

  callEnter(fnName: string, checkpointId?: CheckpointId) {
    this.trace.callEvents.push({
      callId: this.callIdSeq++,
      kind: "enter",
      fnName,
      stepId: this.stepId,
      checkpointId,
    });
  }

  callExit(fnName: string, checkpointId?: CheckpointId) {
    this.trace.callEvents.push({
      callId: this.callIdSeq++,
      kind: "exit",
      fnName,
      stepId: this.stepId,
      checkpointId,
    });
  }
}
