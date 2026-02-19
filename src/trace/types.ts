export type StepId = number;
export type ObjId = string;
export type CheckpointId = string;
export type Key = string;

export type Primitive = null | undefined | boolean | number | string | bigint;

export type ValueRef =
  | { kind: "prim"; v: Primitive }
  | { kind: "obj"; id: ObjId };

export type StepMeta = {
  stepId: StepId;
  checkpointId?: CheckpointId;
  varNames?: string[];
  deltaFrom: number;
  deltaTo: number;
};

export type DeltaEvent =
  | { t: "alloc"; obj: ObjId; objKind: "object" | "array" | "function" | "class"; className?: string }
  | { t: "write"; obj: ObjId; key: Key; val: ValueRef; checkpointId?: CheckpointId }
  | { t: "delete"; obj: ObjId; key: Key; checkpointId?: CheckpointId }
  | { t: "rootSet"; name: string; val: ValueRef; checkpointId?: CheckpointId }
  | { t: "rootDel"; name: string; checkpointId?: CheckpointId };

export type CallEvent = {
  callId: number;
  kind: "enter" | "exit";
  fnName: string;
  stepId: StepId;
  checkpointId?: CheckpointId;
};

export type HeapObject = {
  id: ObjId;
  objKind: "object" | "array" | "function" | "class";
  className?: string;
  props: Record<Key, ValueRef>;
};

export type HeapState = {
  objects: Record<ObjId, HeapObject>;
  roots: Record<string, ValueRef>;
  lastWrite: Record<string, { stepId: StepId; checkpointId?: CheckpointId }>;
};

export type Snapshot = {
  at: StepId;
  state: HeapState;
};

export type TraceLog = {
  steps: StepMeta[];
  events: DeltaEvent[];
  snapshots: Snapshot[];
  callEvents: CallEvent[];
};
