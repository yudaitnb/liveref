export type StepId = number;
export type ObjId = string;
export type LocId = string;
export type Key = string;

export type Primitive = null | undefined | boolean | number | string | bigint;

export type ValueRef =
  | { kind: "prim"; v: Primitive }
  | { kind: "obj"; id: ObjId };

export type StepMeta = {
  stepId: StepId;
  locId?: LocId;
  deltaFrom: number;
  deltaTo: number;
};

export type DeltaEvent =
  | { t: "alloc"; obj: ObjId; objKind: "object" | "array" | "function" | "class" }
  | { t: "write"; obj: ObjId; key: Key; val: ValueRef; locId?: LocId }
  | { t: "delete"; obj: ObjId; key: Key; locId?: LocId }
  | { t: "rootSet"; name: string; val: ValueRef; locId?: LocId }
  | { t: "rootDel"; name: string; locId?: LocId };

export type HeapObject = {
  id: ObjId;
  objKind: "object" | "array" | "function" | "class";
  props: Record<Key, ValueRef>;
};

export type HeapState = {
  objects: Record<ObjId, HeapObject>;
  roots: Record<string, ValueRef>;
  lastWrite: Record<string, { stepId: StepId; locId?: LocId }>;
};

export type Snapshot = {
  at: StepId;
  state: HeapState;
};

export type TraceLog = {
  steps: StepMeta[];
  events: DeltaEvent[];
  snapshots: Snapshot[];
};
