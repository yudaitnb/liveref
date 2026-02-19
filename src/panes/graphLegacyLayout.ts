import type { HeapState } from "../trace/types";

type HintMap = Map<string, { x: number; y: number }>;
type Rect = { x1: number; y1: number; x2: number; y2: number };
type EdgeColor = { color: string; highlight: string; hover: string };
type EdgeCurve = { type: "curvedCW" | "curvedCCW"; roundness: number };
type EdgeSmooth = { enabled: boolean; type: string; roundness: number };
type LegacyLayoutEdge = {
  from: string;
  to: string;
  key: string;
  idealAngle?: number;
  idealLength: number;
  directional: boolean;
  underAngleForce: boolean;
  targetDx?: number;
  targetDy?: number;
  targetK?: number;
};
type LegacyDeemphasisCluster = {
  nodeIds: string[];
  anchorId?: string;
};

export const LEGACY_FIFA = {
  nodeSize: 15,
  // Old rendering looked denser in practice; tune down from prior port values.
  standardEdgeLength: 80,
  variableEdgeLength: 62,
  primitiveEdgeLength: 50,
  edgeFontSize: 10,
  // Old FiFA constants mapped to vis-network's force model.
  CS: 150,
  CR: 150000,
  KRAD: 0.8,
  iteration: 5000,
  subIteration: 5000,
  // Stronger/longer stabilization to match old behavior.
  springConstant: 0.11,
  damping: 0.22,
  avoidOverlap: 0.25,
  repulsion: -7600,
};

export function getLegacyPhysicsOptions() {
  return {
    // Keep physics active like old vis-network setup; nodes are fixed by default
    // and released only during interactions.
    enabled: true,
    solver: "barnesHut" as const,
    timestep: 0.35,
    minVelocity: 0.35,
    maxVelocity: 48,
    barnesHut: {
      gravitationalConstant: LEGACY_FIFA.repulsion,
      centralGravity: 0,
      springLength: LEGACY_FIFA.standardEdgeLength,
      springConstant: LEGACY_FIFA.springConstant,
      damping: LEGACY_FIFA.damping,
      avoidOverlap: LEGACY_FIFA.avoidOverlap,
    },
  };
}

export function getLegacyStabilizeIterations(nodeCount: number, edgeCount: number): number {
  const sizeBoost = Math.min(1700, Math.floor(nodeCount * 7 + edgeCount * 3));
  return 900 + sizeBoost;
}

export function getLegacyEdgeLength(args: {
  key: string;
  isArrayObj: boolean;
  isPrimitiveOrNull: boolean;
  classDeemphasized: boolean;
}): number {
  const { key, isArrayObj, isPrimitiveOrNull, classDeemphasized } = args;
  const base = classDeemphasized
    ? Math.round(LEGACY_FIFA.standardEdgeLength * 0.72)
    : LEGACY_FIFA.standardEdgeLength;

  if (isPrimitiveOrNull) {
    return classDeemphasized
      ? Math.round(LEGACY_FIFA.primitiveEdgeLength * 0.75)
      : LEGACY_FIFA.primitiveEdgeLength;
  }

  if (key === "next") return Math.round(base * 0.66);
  if (key === "left" || key === "right") return Math.round(base * 0.74);
  if (key === "val") return Math.round(base * 0.4);
  if (isArrayObj && /^\d+$/.test(key)) return Math.round(base * 0.6);
  return base;
}

export function getLegacyEdgeColor(args: {
  highlighted: boolean;
  classDeemphasized: boolean;
  isPrimitiveOrNull: boolean;
  isRoot?: boolean;
  isFocusedRoot?: boolean;
}): EdgeColor {
  const { highlighted, classDeemphasized, isPrimitiveOrNull, isRoot, isFocusedRoot } = args;
  if (highlighted) {
    return { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" };
  }
  if (isRoot) {
    return isFocusedRoot
      ? { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" }
      : { color: "#2e7d32", highlight: "#388e3c", hover: "#388e3c" };
  }
  if (classDeemphasized) {
    return isPrimitiveOrNull
      ? { color: "#6f7d8e", highlight: "#8b99aa", hover: "#8b99aa" }
      : { color: "#7d8c9f", highlight: "#95a2b2", hover: "#95a2b2" };
  }
  return isPrimitiveOrNull
    ? { color: "#a0a9b6", highlight: "#c2cad6", hover: "#c2cad6" }
    : { color: "#b7c1ce", highlight: "#d3dbe6", hover: "#d3dbe6" };
}

export function getLegacyFieldIdealAngle(args: {
  key: string;
  fromClass: string;
  childClass: string;
  fieldAngles: Map<string, number>;
}): number | undefined {
  const { key, fromClass, childClass, fieldAngles } = args;
  if (key === "left") return 135;
  if (key === "right") return 45;
  if (key === "val") return 90;
  if (fromClass === "Array" && /^\d+$/.test(key)) return 90;
  return fieldAngles.get(`${fromClass}::${key}::${childClass}`);
}

export function getLegacyDeemphasisEdgeTuning(args: {
  fromClassName?: string;
  toClassName?: string;
  notInterestedClasses: Record<string, true>;
  targetIsPrimitiveOrNull: boolean;
}): { lengthMultiplier: number; smoothEnabled: boolean } {
  const { fromClassName, toClassName, notInterestedClasses, targetIsPrimitiveOrNull } = args;
  const fromDeemph = !!(fromClassName && notInterestedClasses[fromClassName]);
  const toDeemph = !!(toClassName && notInterestedClasses[toClassName]);

  // Old makeMinimalNode intent:
  // - if to is deemphasized: smooth off, length shorter
  // - if both deemphasized: much shorter
  if (toDeemph) {
    if (fromDeemph) return { lengthMultiplier: 1 / 32, smoothEnabled: false };
    return { lengthMultiplier: 1 / 12, smoothEnabled: false };
  }

  // Old rule for deemphasized source -> literal target.
  if (fromDeemph && targetIsPrimitiveOrNull) {
    return { lengthMultiplier: 1 / 32, smoothEnabled: false };
  }

  return { lengthMultiplier: 1, smoothEnabled: true };
}

export function buildLegacyAngleSuppressionSet(
  state: HeapState,
  reachableObjIds: Set<string>,
  isHiddenObj: (objId: string) => boolean
): Set<string> {
  const visibleIds = Array.from(reachableObjIds).filter((id) => !!state.objects[id] && !isHiddenObj(id));

  const sigEdges = new Map<string, Array<{ from: string; to: string }>>();
  visibleIds.forEach((from) => {
    const obj = state.objects[from];
    if (!obj) return;
    const fromClass = classNameOf(obj);
    Object.entries(obj.props).forEach(([key, v]) => {
      if (v.kind !== "obj") return;
      const toObj = state.objects[v.id];
      if (!toObj) return;
      if (isHiddenObj(v.id)) return;
      const toClass = classNameOf(toObj);
      const sig = `${fromClass}::${key}::${toClass}`;
      const arr = sigEdges.get(sig) ?? [];
      arr.push({ from, to: v.id });
      sigEdges.set(sig, arr);
    });
  });

  const parsed = Array.from(sigEdges.keys()).map((sig) => {
    const [fromClass, key, toClass] = sig.split("::");
    return { sig, fromClass, key, toClass };
  });

  const suppress = new Set<string>();
  const getFieldTarget = (id: string, field: string): string | undefined => {
    const o = state.objects[id];
    if (!o) return undefined;
    const v = o.props[field];
    if (!v || v.kind !== "obj") return undefined;
    if (!state.objects[v.id]) return undefined;
    if (isHiddenObj(v.id)) return undefined;
    return v.id;
  };

  parsed.forEach((a) => {
    const revCandidates = parsed.filter((b) => b.fromClass === a.toClass && b.toClass === a.fromClass && b.sig !== a.sig);
    revCandidates.forEach((b) => {
      const bEdges = sigEdges.get(b.sig) ?? [];
      if (!bEdges.length) return;
      let overlap = true;
      for (const e of bEdges) {
        const back = getFieldTarget(e.to, a.key);
        if (back !== e.from) {
          overlap = false;
          break;
        }
      }
      if (!overlap) return;
      const aCount = sigEdges.get(a.sig)?.length ?? 0;
      const bCount = bEdges.length;
      if (aCount >= bCount) suppress.add(a.sig);
    });
  });

  return suppress;
}

export function buildLegacyFieldAngles(
  state: HeapState,
  reachableObjIds: Set<string>,
  isHiddenObj: (objId: string) => boolean
): Map<string, number> {
  const byParent = new Map<string, Array<{ field: string; childClass: string }>>();
  const visible = new Set(
    Array.from(reachableObjIds).filter((id) => !!state.objects[id] && !isHiddenObj(id))
  );

  for (const id of visible) {
    const from = state.objects[id];
    if (!from) continue;
    const parentClass = classNameOf(from);
    for (const [field, value] of Object.entries(from.props)) {
      const childClass = childClassNameOf(state, value);
      if (!childClass) continue;
      if (value.kind === "obj" && !visible.has(value.id)) continue;
      const list = byParent.get(parentClass) ?? [];
      list.push({ field, childClass });
      byParent.set(parentClass, list);
    }
  }

  const out = new Map<string, number>();
  for (const [parent, edges] of byParent.entries()) {
    const groups = new Map<string, Array<{ field: string; childClass: string }>>();
    edges.forEach((e) => {
      const key = groupKey(parent, e.childClass);
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    });

    for (const [gk, list0] of groups.entries()) {
      const list = [...list0].sort((a, b) => a.field.localeCompare(b.field));
      if (parent === "Kanon-ArrayNode" && gk === "normal:Kanon-ArrayNode") {
        list.forEach((e) => {
          const angle = e.field === "next" ? 0 : e.field === "ref" ? 90 : 90;
          out.set(`${parent}::${e.field}::${e.childClass}`, angle);
        });
        continue;
      }

      const n = list.length;
      list.forEach((e, i) => {
        let angle = 90;
        if (gk === "same") {
          angle = n === 1 ? 0 : 180 - (180 / (n * 2)) * (2 * i + 1);
        } else if (gk === "primitive") {
          angle = 120 - (60 / (n * 2)) * (2 * i + 1);
        } else {
          angle = 180 - (180 / (n * 2)) * (2 * i + 1);
        }
        out.set(`${parent}::${e.field}::${e.childClass}`, angle);
      });
    }
  }

  return out;
}

export function getLegacyEdgeCurve(args: {
  idealAngle?: number;
  hasReverse: boolean;
  fromId: string;
  toId: string;
  dirTotal: number;
  dirIndex: number;
}): EdgeCurve {
  const { idealAngle, hasReverse, fromId, toId } = args;
  const type = hasReverse
    ? (fromId < toId ? "curvedCW" : "curvedCCW")
    : ((idealAngle ?? 90) >= 90 ? "curvedCW" : "curvedCCW");
  return { type, roundness: 0.08 };
}

export function getLegacyStructuredEdgeSmooth(key: string): EdgeSmooth | null {
  if (key === "next") {
    return { enabled: true, type: "dynamic", roundness: 0.08 };
  }
  if (key === "left") {
    return { enabled: true, type: "dynamic", roundness: 0.08 };
  }
  if (key === "right") {
    return { enabled: true, type: "dynamic", roundness: 0.08 };
  }
  return null;
}

export function buildLegacyCycleEdgeSet(
  state: HeapState,
  reachableObjIds: Set<string>,
  isHiddenObj: (objId: string) => boolean
): Set<string> {
  const visible = new Set(
    Array.from(reachableObjIds).filter((id) => !!state.objects[id] && !isHiddenObj(id))
  );
  const color = new Map<string, 0 | 1 | 2>();
  const nodeStack: string[] = [];
  const edgeStack: string[] = [];
  const cycle = new Set<string>();

  const dfs = (u: string) => {
    color.set(u, 1);
    nodeStack.push(u);
    const obj = state.objects[u];
    if (obj) {
      const props = Object.entries(obj.props).sort(([a], [b]) => a.localeCompare(b));
      for (const [key, v] of props) {
        if (v.kind !== "obj") continue;
        if (!visible.has(v.id)) continue;
        const ek = makeEdgeKey(u, key, v.id);
        const c = color.get(v.id) ?? 0;
        if (c === 0) {
          edgeStack.push(ek);
          dfs(v.id);
          edgeStack.pop();
        } else if (c === 1) {
          cycle.add(ek);
          const start = nodeStack.lastIndexOf(v.id);
          if (start >= 0) {
            for (let i = start; i < edgeStack.length; i++) cycle.add(edgeStack[i]);
          }
        }
      }
    }
    nodeStack.pop();
    color.set(u, 2);
  };

  for (const id of visible) {
    if ((color.get(id) ?? 0) === 0) dfs(id);
  }
  return cycle;
}

export function buildLegacyObjectLayout(args: {
  state: HeapState;
  reachableObjIds: Set<string>;
  isHiddenObj: (objId: string) => boolean;
  seeds: Map<string, { x: number; y: number }>;
  structuralHints: HintMap;
  fieldAngles: Map<string, number>;
  cycleEdgeSet?: Set<string>;
  suppressedAngleSignatures?: Set<string>;
  notInterestedClasses?: Record<string, true>;
}): Map<string, { x: number; y: number }> {
  const {
    state,
    reachableObjIds,
    isHiddenObj,
    seeds,
    structuralHints,
    fieldAngles,
    cycleEdgeSet,
    suppressedAngleSignatures,
    notInterestedClasses = {},
  } = args;
  const ids = Array.from(reachableObjIds)
    .filter((id) => !!state.objects[id] && !isHiddenObj(id))
    .sort();
  const out = new Map<string, { x: number; y: number }>();
  if (!ids.length) return out;

  const idx = new Map<string, number>();
  ids.forEach((id, i) => idx.set(id, i));

  const pos = ids.map((id, i) => {
    const s = seeds.get(id);
    if (s) return { x: s.x, y: s.y };
    const h = structuralHints.get(id);
    if (h) return { x: h.x, y: h.y };
    return { x: 120 + (i % 7) * 120, y: 120 + Math.floor(i / 7) * 110 };
  });

  const edges: LegacyLayoutEdge[] = [];
  const adjacency = new Set<string>();
  const suppressedSet = suppressedAngleSignatures ?? buildLegacyAngleSuppressionSet(state, reachableObjIds, isHiddenObj);
  const isDeemphasizedNode = new Set<string>();
  const isInterestingNode = new Set<string>();
  const arraySlotOffsetByKey = new Map<string, number>();
  for (const id of ids) {
    const obj = state.objects[id];
    const deemph = !!(obj?.className && notInterestedClasses[obj.className]);
    if (deemph) isDeemphasizedNode.add(id);
    else isInterestingNode.add(id);
    if (obj?.objKind === "array") {
      const numericObjFields = Object.entries(obj.props)
        .filter(([k, v]) => /^\d+$/.test(k) && v.kind === "obj" && idx.has(v.id))
        .sort((a, b) => Number(a[0]) - Number(b[0]));
      const mid = (numericObjFields.length - 1) / 2;
      numericObjFields.forEach(([k], order) => {
        arraySlotOffsetByKey.set(`${id}::${k}`, (order - mid) * 34);
      });
    }
  }
  const cycleSet = cycleEdgeSet ?? buildLegacyCycleEdgeSet(state, reachableObjIds, isHiddenObj);
  for (const from of ids) {
    const fromObj = state.objects[from];
    if (!fromObj) continue;
    const fromClass = classNameOf(fromObj);
    for (const [key, value] of Object.entries(fromObj.props)) {
      if (value.kind !== "obj") continue;
      if (!idx.has(value.id)) continue;
      const toObj = state.objects[value.id];
      if (!toObj) continue;
      const toClass = classNameOf(toObj);
      const classDeemphasized = !!(fromObj.className && notInterestedClasses[fromObj.className]);
      const toClassDeemphasized = !!(toObj.className && notInterestedClasses[toObj.className]);
      let idealLength = getLegacyEdgeLength({
        key,
        isArrayObj: fromObj.objKind === "array",
        isPrimitiveOrNull: false,
        classDeemphasized,
      });
      if (classDeemphasized && toClassDeemphasized) {
        idealLength = Math.max(18, Math.round(idealLength * 0.26));
      } else if (classDeemphasized || toClassDeemphasized) {
        idealLength = Math.max(30, Math.round(idealLength * 0.52));
      }
      const edgeKey = makeEdgeKey(from, key, value.id);
      const angleSig = `${fromClass}::${key}::${toClass}`;
      let targetDx: number | undefined;
      let targetDy: number | undefined;
      let targetK: number | undefined;
      if (key === "left") {
        targetDx = -120;
        targetDy = 120;
        targetK = 0.024;
      } else if (key === "right") {
        targetDx = 120;
        targetDy = 120;
        targetK = 0.024;
      } else if (key === "val") {
        targetDx = 0;
        targetDy = 124;
        targetK = 0.11;
      } else if (fromObj.objKind === "array" && /^\d+$/.test(key)) {
        targetDx = arraySlotOffsetByKey.get(`${from}::${key}`) ?? 0;
        targetDy = 88;
        targetK = 0.021;
      }
      edges.push({
        from,
        to: value.id,
        key,
        idealAngle: getLegacyFieldIdealAngle({
          key,
          fromClass,
          childClass: toClass,
          fieldAngles,
        }),
        idealLength,
        directional: key === "left" || key === "right",
        underAngleForce: !cycleSet.has(edgeKey) && !suppressedSet.has(angleSig),
        targetDx,
        targetDy,
        targetK,
      });
      adjacency.add(`${from}->${value.id}`);
      adjacency.add(`${value.id}->${from}`);
    }
  }

  const deemphasisClusters = buildLegacyDeemphasisClusters(
    edges,
    isDeemphasizedNode,
    isInterestingNode
  );
  const orderedDeemphasisClusters = orderLegacyDeemphasisClustersByAngle(
    deemphasisClusters,
    edges
  );
  const clusterIndexByNode = new Map<string, number>();
  orderedDeemphasisClusters.forEach((c, i) => c.nodeIds.forEach((id) => clusterIndexByNode.set(id, i)));
  const clusterAnchorIndex = orderedDeemphasisClusters.map((c) =>
    c.anchorId ? (idx.get(c.anchorId) ?? null) : null
  );

  const N = ids.length;
  const cs = LEGACY_FIFA.CS;
  const cr = LEGACY_FIFA.CR;
  // Match old FiFA defaults more closely (old code used ITERATION=3000).
  const iterations = Math.max(1, LEGACY_FIFA.iteration);
  let temp = 30;
  const dt = temp / iterations;
  const fx = new Array<number>(N).fill(0);
  const fy = new Array<number>(N).fill(0);
  const neighbors: Array<Set<number>> = Array.from({ length: N }, () => new Set<number>());
  for (const e of edges) {
    const i = idx.get(e.from);
    const j = idx.get(e.to);
    if (i === undefined || j === undefined) continue;
    neighbors[i].add(j);
    neighbors[j].add(i);
  }

  for (let step = 0; step < iterations; step++) {
    fx.fill(0);
    fy.fill(0);

    for (const e of edges) {
      const i = idx.get(e.from);
      const j = idx.get(e.to);
      if (i === undefined || j === undefined) continue;
      const dx = pos[j].x - pos[i].x;
      const dy = pos[j].y - pos[i].y;
      const dist = Math.max(1, Math.hypot(dx, dy));

      const spring = springForce(dist, cs, e.idealLength) / dist * 0.0022;
      fx[i] += dx * spring;
      fy[i] += dy * spring;
      fx[j] -= dx * spring;
      fy[j] -= dy * spring;

      const desiredAngle = e.idealAngle ?? (e.key === "left" ? 135 : e.key === "right" ? 45 : undefined);
      if (e.underAngleForce && desiredAngle !== undefined) {
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const d = normalizeAngleDeg(angle - desiredAngle);
        const ex = dy / dist;
        const ey = -dx / dist;
        const weight = e.key === "val"
          ? 0.021
          : e.directional
            ? 0.0062
            : 0.003;
        const mag = LEGACY_FIFA.KRAD * d * Math.abs(d) * weight;
        fx[i] += -ex * mag;
        fy[i] += -ey * mag;
        fx[j] += ex * mag;
        fy[j] += ey * mag;
      }

      if (e.targetDx !== undefined && e.targetDy !== undefined) {
        const ex = dx - e.targetDx;
        const ey = dy - e.targetDy;
        const kDir = e.targetK ?? (e.directional ? 0.024 : 0.016);
        fx[i] += ex * kDir;
        fy[i] += ey * kDir;
        fx[j] -= ex * kDir;
        fy[j] -= ey * kDir;
      }
    }

    for (let a = 0; a < N; a++) {
      for (let b = a + 1; b < N; b++) {
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        if (dist > 900) continue;
        let rep = repelForce(dist, cr) / dist * 0.021;
        const ca = clusterIndexByNode.get(ids[a]);
        const cb = clusterIndexByNode.get(ids[b]);
        if (ca !== undefined && cb !== undefined && ca === cb) rep *= 0.08;
        if (adjacency.has(`${ids[a]}->${ids[b]}`)) rep *= 0.25;
        fx[a] += dx * rep;
        fy[a] += dy * rep;
        fx[b] -= dx * rep;
        fy[b] -= dy * rep;
      }
    }

    // Old minimal-node cluster intent: keep de-emphasized components compact.
    orderedDeemphasisClusters.forEach((cluster, ci) => {
      if (cluster.nodeIds.length === 0) return;
      const anchorI = clusterAnchorIndex[ci];

      if (anchorI !== null && anchorI !== undefined) {
        const ax = pos[anchorI].x;
        const ay = pos[anchorI].y;
        cluster.nodeIds.forEach((id, order) => {
          const i = idx.get(id);
          if (i === undefined) return;
          const tx = (order - (cluster.nodeIds.length - 1) / 2) * 16;
          const ty = 28 + (order % 2) * 8;
          const ex = (pos[i].x - ax) - tx;
          const ey = (pos[i].y - ay) - ty;
          const k = 0.052;
          fx[i] += -ex * k;
          fy[i] += -ey * k;
          fx[anchorI] += ex * k * 0.12;
          fy[anchorI] += ey * k * 0.12;
        });
      } else {
        let cx = 0;
        let cy = 0;
        let n = 0;
        cluster.nodeIds.forEach((id) => {
          const i = idx.get(id);
          if (i === undefined) return;
          cx += pos[i].x;
          cy += pos[i].y;
          n++;
        });
        if (!n) return;
        cx /= n;
        cy /= n;
        cluster.nodeIds.forEach((id) => {
          const i = idx.get(id);
          if (i === undefined) return;
          fx[i] += -(pos[i].x - cx) * 0.032;
          fy[i] += -(pos[i].y - cy) * 0.032;
        });
      }
    });

    for (let i = 0; i < N; i++) {
      const dx = fx[i];
      const dy = fy[i];
      const disp = Math.hypot(dx, dy);
      if (disp < 1e-6) continue;
      const s = Math.min(disp, temp) / disp;
      pos[i].x += dx * s;
      pos[i].y += dy * s;
    }

    temp = Math.max(0, temp - dt);
  }

  applyLegacyGroupCentering(pos, neighbors, LEGACY_FIFA.CS);

  // Keep graph center stable.
  let cx = 0;
  let cy = 0;
  for (const p of pos) {
    cx += p.x;
    cy += p.y;
  }
  cx /= N;
  cy /= N;
  const shiftX = 360 - cx;
  const shiftY = 180 - cy;
  ids.forEach((id, i) => {
    out.set(id, { x: pos[i].x + shiftX, y: pos[i].y + shiftY });
  });
  return out;
}

export function buildStructuralLayoutHints(
  state: HeapState,
  reachableObjIds: Set<string>,
  isHiddenObj: (objId: string) => boolean,
  seedPositions?: Map<string, { x: number; y: number }>
): HintMap {
  const hints: HintMap = new Map();
  const visibleIds = Array.from(reachableObjIds).filter((id) => !!state.objects[id] && !isHiddenObj(id));
  const visibleSet = new Set(visibleIds);
  const getSeed = (id: string) => seedPositions?.get(id) ?? null;

  // Linked-list inspired layout: `next` chains arranged horizontally.
  const nextIn = new Map<string, number>();
  const nextOut = new Map<string, string>();
  for (const id of visibleIds) {
    const nextRef = state.objects[id]?.props?.next;
    if (nextRef?.kind === "obj" && visibleSet.has(nextRef.id)) {
      nextOut.set(id, nextRef.id);
      nextIn.set(nextRef.id, (nextIn.get(nextRef.id) ?? 0) + 1);
    }
  }

  const listHeads = visibleIds.filter((id) => nextOut.has(id) && !nextIn.has(id));
  const listVisited = new Set<string>();
  listHeads.forEach((head, listIdx) => {
    const chain: string[] = [];
    let cur: string | undefined = head;
    while (cur && !listVisited.has(cur) && visibleSet.has(cur)) {
      listVisited.add(cur);
      chain.push(cur);
      cur = nextOut.get(cur);
    }

    if (chain.length === 0) return;
    const seedCenter = centerOf(chain, getSeed);
    const cx = seedCenter?.x ?? 200 + listIdx * 140;
    const cy = seedCenter?.y ?? 120 + listIdx * 140;
    const spacing = 100;
    const start = cx - ((chain.length - 1) * spacing) / 2;
    chain.forEach((id, i) => {
      hints.set(id, { x: start + i * spacing, y: cy });
    });
  });

  // Include isolated `next` cycles with no unique head.
  visibleIds.forEach((id, idx) => {
    if (!nextOut.has(id) || listVisited.has(id)) return;
    const cycle: string[] = [];
    let cur: string | undefined = id;
    while (cur && !listVisited.has(cur) && visibleSet.has(cur)) {
      listVisited.add(cur);
      cycle.push(cur);
      cur = nextOut.get(cur);
    }
    if (cycle.length === 0) return;
    const seedCenter = centerOf(cycle, getSeed);
    const cx = seedCenter?.x ?? 220 + idx * 120;
    const cy = seedCenter?.y ?? 220;
    const spacing = 90;
    const start = cx - ((cycle.length - 1) * spacing) / 2;
    cycle.forEach((nid, i) => {
      if (!hints.has(nid)) hints.set(nid, { x: start + i * spacing, y: cy });
    });
  });

  // Binary-tree inspired layout: `left`/`right` by depth and slot.
  const lrParents = new Set<string>();
  const lrChildren = new Set<string>();
  for (const id of visibleIds) {
    const left = state.objects[id]?.props?.left;
    const right = state.objects[id]?.props?.right;
    if (left?.kind === "obj" && visibleSet.has(left.id)) {
      lrParents.add(id);
      lrChildren.add(left.id);
    }
    if (right?.kind === "obj" && visibleSet.has(right.id)) {
      lrParents.add(id);
      lrChildren.add(right.id);
    }
  }

  const treeRoots = Array.from(lrParents).filter((id) => !lrChildren.has(id));
  const treeVisited = new Set<string>();
  const treeLayouts: Array<{ nodes: Array<{ id: string; depth: number; slot: number }>; idx: number }> = [];

  treeRoots.forEach((root, treeIdx) => {
    const nodes: Array<{ id: string; depth: number; slot: number }> = [];
    const q: Array<{ id: string; depth: number; slot: number }> = [{ id: root, depth: 0, slot: 0 }];
    while (q.length) {
      const cur = q.shift()!;
      if (treeVisited.has(cur.id) || !visibleSet.has(cur.id)) continue;
      treeVisited.add(cur.id);
      nodes.push(cur);

      const left = state.objects[cur.id]?.props?.left;
      const right = state.objects[cur.id]?.props?.right;
      if (left?.kind === "obj" && visibleSet.has(left.id)) {
        q.push({ id: left.id, depth: cur.depth + 1, slot: cur.slot * 2 });
      }
      if (right?.kind === "obj" && visibleSet.has(right.id)) {
        q.push({ id: right.id, depth: cur.depth + 1, slot: cur.slot * 2 + 1 });
      }
    }
    if (nodes.length) treeLayouts.push({ nodes, idx: treeIdx });
  });

  treeLayouts.forEach((tree) => {
    const root = tree.nodes.find((n) => n.depth === 0);
    if (!root) return;

    const maxDepth = tree.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
    const width = Math.max(1, 2 ** maxDepth);

    const rel = new Map<string, { x: number; y: number }>();
    tree.nodes.forEach((n) => {
      const x = ((n.slot + 0.5) - width / 2) * 100;
      const y = n.depth * 100;
      rel.set(n.id, { x, y });
    });

    const relCenter = averageFromMap(tree.nodes.map((n) => n.id), rel) ?? { x: 0, y: 0 };
    const seedCenter = centerOf(
      tree.nodes.map((n) => n.id),
      getSeed
    );
    const cx = seedCenter?.x ?? 500 + tree.idx * 420;
    const cy = seedCenter?.y ?? 140;
    const shiftX = cx - relCenter.x;
    const shiftY = cy - relCenter.y;

    tree.nodes.forEach((n) => {
      const p = rel.get(n.id)!;
      hints.set(n.id, { x: p.x + shiftX, y: p.y + shiftY });
    });
  });

  // Include isolated tree components with no unique root.
  visibleIds.forEach((id, idx) => {
    if (treeVisited.has(id)) return;
    const left = state.objects[id]?.props?.left;
    const right = state.objects[id]?.props?.right;
    if (!((left?.kind === "obj" && visibleSet.has(left.id)) || (right?.kind === "obj" && visibleSet.has(right.id)))) {
      return;
    }

    const q: string[] = [id];
    const component: string[] = [];
    while (q.length) {
      const cur = q.shift()!;
      if (treeVisited.has(cur) || !visibleSet.has(cur)) continue;
      treeVisited.add(cur);
      component.push(cur);
      const l = state.objects[cur]?.props?.left;
      const r = state.objects[cur]?.props?.right;
      if (l?.kind === "obj" && visibleSet.has(l.id)) q.push(l.id);
      if (r?.kind === "obj" && visibleSet.has(r.id)) q.push(r.id);
    }

    if (!component.length) return;
    const seedCenter = centerOf(component, getSeed);
    const cx = seedCenter?.x ?? 460 + idx * 80;
    const cy = seedCenter?.y ?? 340;
    const spacing = 96;
    const start = cx - ((component.length - 1) * spacing) / 2;
    component.forEach((nid, i) => {
      hints.set(nid, { x: start + i * spacing, y: cy });
    });
  });

  return hints;
}

export function buildValueNodeHints(
  state: HeapState,
  structuralHints: HintMap,
  reachableObjIds: Set<string>,
  isHiddenObj: (objId: string) => boolean
): HintMap {
  const hints: HintMap = new Map();
  const visibleIds = Array.from(reachableObjIds).filter((id) => !!state.objects[id] && !isHiddenObj(id));

  for (const id of visibleIds) {
    const anchor = structuralHints.get(id);
    if (!anchor) continue;
    const obj = state.objects[id];
    if (!obj) continue;

    // Old Kanon intent: list/tree node's `val` is placed directly below the node.
    const hasListShape = obj.props.next?.kind === "obj";
    const hasTreeShape = obj.props.left?.kind === "obj" || obj.props.right?.kind === "obj";
    if (!hasListShape && !hasTreeShape) continue;

    const val = obj.props.val;
    if (!val) continue;
    if (val.kind === "obj") continue; // only value nodes (primitive/null) get this hint

    const yOffset = hasTreeShape ? 78 : 66;
    if (val.v === null) {
      hints.set(`n:${id}:val`, { x: anchor.x, y: anchor.y + yOffset });
    } else {
      hints.set(`p:${id}:val`, { x: anchor.x, y: anchor.y + yOffset });
    }
  }

  return hints;
}

export function applyRegionPushdownForLegacyStructures(
  state: HeapState,
  reachableObjIds: Set<string>,
  isHiddenObj: (objId: string) => boolean,
  structuralHints: HintMap,
  positions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>(positions);
  const visibleIds = Array.from(reachableObjIds).filter((id) => !!state.objects[id] && !isHiddenObj(id));
  const visibleSet = new Set(visibleIds);
  const structuredIds = new Set(structuralHints.keys());

  const nextIn = new Map<string, number>();
  const nextOut = new Map<string, string>();
  for (const id of visibleIds) {
    const nextRef = state.objects[id]?.props?.next;
    if (nextRef?.kind === "obj" && visibleSet.has(nextRef.id)) {
      nextOut.set(id, nextRef.id);
      nextIn.set(nextRef.id, (nextIn.get(nextRef.id) ?? 0) + 1);
    }
  }

  const regions: Rect[] = [];
  const listHeads = visibleIds.filter((id) => nextOut.has(id) && !nextIn.has(id));
  const listVisited = new Set<string>();
  for (const head of listHeads) {
    const chain: string[] = [];
    let cur: string | undefined = head;
    while (cur && !listVisited.has(cur) && visibleSet.has(cur)) {
      listVisited.add(cur);
      chain.push(cur);
      cur = nextOut.get(cur);
    }
    if (chain.length <= 1) continue;
    const rect = boundsOf(chain, structuralHints);
    if (rect) {
      // Old Kanon reserved area includes val node rows under the list nodes.
      rect.y2 += 120;
      rect.x1 -= 10;
      rect.x2 += 10;
      regions.push(rect);
    }
  }

  const lrParents = new Set<string>();
  const lrChildren = new Set<string>();
  for (const id of visibleIds) {
    const left = state.objects[id]?.props?.left;
    const right = state.objects[id]?.props?.right;
    if (left?.kind === "obj" && visibleSet.has(left.id)) {
      lrParents.add(id);
      lrChildren.add(left.id);
    }
    if (right?.kind === "obj" && visibleSet.has(right.id)) {
      lrParents.add(id);
      lrChildren.add(right.id);
    }
  }
  const treeRoots = Array.from(lrParents).filter((id) => !lrChildren.has(id));
  const treeVisited = new Set<string>();
  for (const root of treeRoots) {
    const nodes: string[] = [];
    const q: string[] = [root];
    while (q.length) {
      const id = q.shift()!;
      if (treeVisited.has(id) || !visibleSet.has(id)) continue;
      treeVisited.add(id);
      nodes.push(id);
      const left = state.objects[id]?.props?.left;
      const right = state.objects[id]?.props?.right;
      if (left?.kind === "obj" && visibleSet.has(left.id)) q.push(left.id);
      if (right?.kind === "obj" && visibleSet.has(right.id)) q.push(right.id);
    }
    if (nodes.length <= 1) continue;
    const rect = boundsOf(nodes, structuralHints);
    if (rect) {
      rect.y2 += 110;
      rect.x1 -= 12;
      rect.x2 += 12;
      regions.push(rect);
    }
  }

  if (regions.length === 0) return out;

  for (const id of visibleIds) {
    if (structuredIds.has(id)) continue;
    const pos = out.get(id);
    if (!pos) continue;
    let y = pos.y;
    for (const r of regions) {
      if (pos.x >= r.x1 && pos.x <= r.x2 && y >= r.y1 && y <= r.y2) {
        y = Math.max(y, r.y2 + 60);
      }
    }
    if (y !== pos.y) out.set(id, { x: pos.x, y });
  }

  return out;
}

function boundsOf(ids: string[], hints: HintMap): Rect | null {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const id of ids) {
    const p = hints.get(id);
    if (!p) continue;
    count++;
    if (p.x < x1) x1 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x;
    if (p.y > y2) y2 = p.y;
  }
  if (count === 0) return null;
  return { x1, y1, x2, y2 };
}

function centerOf(
  ids: string[],
  get: (id: string) => { x: number; y: number } | null
): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  ids.forEach((id) => {
    const p = get(id);
    if (!p) return;
    sx += p.x;
    sy += p.y;
    n++;
  });
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

function averageFromMap(
  ids: string[],
  m: Map<string, { x: number; y: number }>
): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  ids.forEach((id) => {
    const p = m.get(id);
    if (!p) return;
    sx += p.x;
    sy += p.y;
    n++;
  });
  if (!n) return null;
  return { x: sx / n, y: sy / n };
}

function classNameOf(obj: HeapState["objects"][string]): string {
  return obj.className ?? (obj.objKind === "array" ? "Array" : obj.objKind === "function" ? "Function" : obj.objKind === "class" ? "Class" : "Object");
}

function childClassNameOf(state: HeapState, value: HeapState["objects"][string]["props"][string]): string | null {
  if (value.kind === "obj") {
    const o = state.objects[value.id];
    if (!o) return null;
    return classNameOf(o);
  }
  if (value.v === null) return "null";
  return `primitive:${typeof value.v}`;
}

function groupKey(parentClass: string, childClass: string): string {
  if (parentClass === childClass) return "same";
  if (childClass.startsWith("primitive:") || childClass === "null") return "primitive";
  return `normal:${childClass}`;
}

function springForce(distance: number, c: number, idealLength: number): number {
  const ratio = distance / Math.max(1, idealLength);
  const p = Math.max(1, Math.pow(ratio, 1.5)) * Math.log(Math.max(1e-4, ratio));
  return c * p;
}

function repelForce(distance: number, c: number): number {
  return c / Math.max(1, distance * distance);
}

function normalizeAngleDeg(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function makeEdgeKey(from: string, key: string, to: string): string {
  return `${from}::${key}::${to}`;
}

function applyLegacyGroupCentering(
  pos: Array<{ x: number; y: number }>,
  neighbors: Array<Set<number>>,
  springConstant: number
): void {
  const components = findConnectedComponents(neighbors);
  if (components.length <= 1) return;

  // Old move_near_center used 1000 iterations.
  let temp = 16;
  const iterations = 1500;
  const dt = temp / iterations;

  for (let it = 0; it < iterations; it++) {
    const rects = components.map((nodes) => componentRect(nodes, pos));
    const fx = new Array<number>(components.length).fill(0);
    const fy = new Array<number>(components.length).fill(0);

    for (let i = 0; i < components.length; i++) {
      for (let j = 0; j < components.length; j++) {
        if (i === j) continue;
        const a = rects[i];
        const b = rects[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ideal = Math.max(80, (a.diag + b.diag) * 1.1);
        const s = springForce(dist, springConstant, ideal) * 0.0018;
        fx[i] += (dx / dist) * s;
        fy[i] += (dy / dist) * s;
      }
    }

    for (let i = 0; i < components.length; i++) {
      const dx = fx[i];
      const dy = fy[i];
      const disp = Math.hypot(dx, dy);
      if (disp < 1e-6) continue;
      const s = Math.min(disp, temp) / disp;
      const mx = dx * s;
      const my = dy * s;
      components[i].forEach((id) => {
        pos[id].x += mx;
        pos[id].y += my;
      });
    }
    temp = Math.max(0, temp - dt);
  }
}

function findConnectedComponents(neighbors: Array<Set<number>>): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let i = 0; i < neighbors.length; i++) {
    if (seen.has(i)) continue;
    const q = [i];
    const comp: number[] = [];
    seen.add(i);
    while (q.length) {
      const u = q.shift()!;
      comp.push(u);
      neighbors[u].forEach((v) => {
        if (seen.has(v)) return;
        seen.add(v);
        q.push(v);
      });
    }
    out.push(comp);
  }
  return out;
}

function componentRect(
  nodes: number[],
  pos: Array<{ x: number; y: number }>
): { cx: number; cy: number; diag: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  nodes.forEach((id) => {
    const p = pos[id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const diag = Math.max(Math.hypot(dx, dy) / 2, LEGACY_FIFA.nodeSize * 5);
  return { cx, cy, diag };
}

function buildLegacyDeemphasisClusters(
  edges: LegacyLayoutEdge[],
  deemphasized: Set<string>,
  interesting: Set<string>
): LegacyDeemphasisCluster[] {
  if (!deemphasized.size) return [];

  const undirected = new Map<string, Set<string>>();
  const incomingFromInteresting = new Map<string, Set<string>>();

  const touch = (a: string, b: string) => {
    const s = undirected.get(a) ?? new Set<string>();
    s.add(b);
    undirected.set(a, s);
  };

  edges.forEach((e) => {
    const aSmall = deemphasized.has(e.from);
    const bSmall = deemphasized.has(e.to);
    if (aSmall && bSmall) {
      touch(e.from, e.to);
      touch(e.to, e.from);
      return;
    }
    if (!aSmall && bSmall && interesting.has(e.from)) {
      const s = incomingFromInteresting.get(e.to) ?? new Set<string>();
      s.add(e.from);
      incomingFromInteresting.set(e.to, s);
    }
  });

  const visited = new Set<string>();
  const out: LegacyDeemphasisCluster[] = [];
  const nodes = Array.from(deemphasized).sort();

  for (const start of nodes) {
    if (visited.has(start)) continue;
    const q = [start];
    const comp: string[] = [];
    visited.add(start);
    while (q.length) {
      const u = q.shift()!;
      comp.push(u);
      const ns = undirected.get(u);
      if (!ns) continue;
      for (const v of ns) {
        if (visited.has(v)) continue;
        visited.add(v);
        q.push(v);
      }
    }
    comp.sort();

    let anchorId: string | undefined = undefined;
    const candidates = new Set<string>();
    comp.forEach((id) => {
      const inc = incomingFromInteresting.get(id);
      if (!inc) return;
      inc.forEach((x) => candidates.add(x));
    });
    if (candidates.size) {
      anchorId = Array.from(candidates).sort()[0];
    }
    out.push({ nodeIds: comp, anchorId });
  }

  return out;
}

function orderLegacyDeemphasisClustersByAngle(
  clusters: LegacyDeemphasisCluster[],
  edges: LegacyLayoutEdge[]
): LegacyDeemphasisCluster[] {
  return clusters.map((cluster) => {
    if (cluster.nodeIds.length <= 1) return cluster;
    const inCluster = new Set(cluster.nodeIds);
    const outMap = new Map<string, Array<{ to: string; angle: number }>>();
    const inDeg = new Map<string, number>();

    cluster.nodeIds.forEach((id) => inDeg.set(id, 0));
    edges.forEach((e) => {
      if (!inCluster.has(e.from) || !inCluster.has(e.to)) return;
      const arr = outMap.get(e.from) ?? [];
      arr.push({ to: e.to, angle: e.idealAngle ?? 90 });
      outMap.set(e.from, arr);
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    });

    outMap.forEach((arr) =>
      arr.sort((a, b) => b.angle - a.angle || a.to.localeCompare(b.to))
    );

    const roots = cluster.nodeIds
      .filter((id) => (inDeg.get(id) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
    const ordered: string[] = [];
    const visited = new Set<string>();

    const walk = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const outs = outMap.get(id) ?? [];
      if (outs.length === 0) {
        ordered.push(id);
        return;
      }
      let inserted = false;
      for (const out of outs) {
        if (!inserted && out.angle <= 90) {
          ordered.push(id);
          inserted = true;
        }
        walk(out.to);
      }
      if (!inserted) ordered.push(id);
    };

    if (roots.length) roots.forEach((id) => walk(id));
    else walk(cluster.nodeIds[0]);
    cluster.nodeIds.forEach((id) => walk(id));

    return {
      ...cluster,
      nodeIds: ordered,
    };
  });
}
