import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { DataSet } from "vis-data";
import { Network } from "vis-network";
import "vis-network/styles/vis-network.css";

import { getStateAt } from "../trace/replay";
import { useUIStore } from "../state/uiStore";
import { useTraceStore } from "../state/traceStore";
import { useGraphStore } from "../state/graphStore";
import { useCodeStore } from "../state/codeStore";
import {
  LEGACY_FIFA,
  applyRegionPushdownForLegacyStructures,
  buildLegacyAngleSuppressionSet,
  buildLegacyCycleEdgeSet,
  buildLegacyFieldAngles,
  buildLegacyObjectLayout,
  buildStructuralLayoutHints,
  buildValueNodeHints,
  getLegacyDeemphasisEdgeTuning,
  getLegacyEdgeColor,
  getLegacyEdgeLength,
  getLegacyFieldIdealAngle,
  getLegacyPhysicsOptions,
  getLegacyStructuredEdgeSmooth,
} from "./graphLegacyLayout";

type VisNode = {
  id: string;
  label: string;
  hidden?: boolean;
  x?: number;
  y?: number;
  fixed?: boolean | { x: boolean; y: boolean };
  physics?: boolean;
  group?: "rootAnchor" | "obj" | "objHighlight" | "prim" | "null";
  font?: { size?: number; color?: string };
  margin?: number | { top: number; right: number; bottom: number; left: number };
  shape?: "box" | "ellipse" | "dot" | "circle";
  size?: number;
  borderWidth?: number;
  color?: { background?: string; border?: string };
  opacity?: number;
};

type VisEdge = {
  id: string;
  from: string;
  to: string;
  hidden?: boolean;
  label?: string;
  length?: number;
  arrows?: string;
  dashes?: boolean;
  smooth?: { enabled?: boolean; type?: string; roundness?: number };
  width?: number;
  color?: { color?: string; highlight?: string; hover?: string };
  font?: { size?: number; align?: "top" | "middle" | "bottom" };
  data?: any;
};

type EdgeCurveOverride = {
  type: "curvedCW" | "curvedCCW";
  roundness: number;
};

type SubPaneId = "null-controls" | "class-definitions" | "available-variables";

const SUB_PANE_LABELS: Record<SubPaneId, string> = {
  "null-controls": "Null Controls",
  "class-definitions": "Classes",
  "available-variables": "Variables",
};
const SUB_PANE_IDS: SubPaneId[] = [
  "null-controls",
  "class-definitions",
  "available-variables",
];

function litLabel(x: unknown): string {
  if (typeof x === "string") return JSON.stringify(x);
  if (x === null) return "null";
  if (typeof x === "undefined") return "undefined";
  if (typeof x === "number" && Number.isNaN(x)) return "NaN";
  return String(x);
}

// ★ instrument が作る一時変数を除外（必要なら増やしてOK）
function isInternalVarName(name: string) {
  return (
    name.startsWith("__") || // __o, __a, __tmp...
    name.startsWith("_o") || // _o...
    name.startsWith("_a")    // _a...
  );
}

function isArrayIndexKey(key: string): boolean {
  if (!/^\d+$/.test(key)) return false;
  const n = Number(key);
  return Number.isInteger(n) && n >= 0;
}

function isUndefinedValue(v: unknown): boolean {
  return typeof v === "undefined";
}

function isNaNValue(v: unknown): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

type ClassSummary = {
  name: string;
  fields: string[];
};

function findMatchingBrace(src: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (!escaped && ch === "\\") {
        escaped = true;
        continue;
      }
      if (!escaped && ch === quote) quote = null;
      escaped = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractClassSummaries(code: string): ClassSummary[] {
  const out: ClassSummary[] = [];
  const classRe = /\bclass\s+([A-Za-z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null = null;

  while ((m = classRe.exec(code))) {
    const name = m[1];
    const bodyOpen = code.indexOf("{", classRe.lastIndex);
    if (bodyOpen < 0) break;
    const bodyClose = findMatchingBrace(code, bodyOpen);
    if (bodyClose < 0) break;

    const body = code.slice(bodyOpen + 1, bodyClose);
    const fields = new Set<string>();

    const ctorRe = /\bconstructor\s*\(/g;
    const ctorMatch = ctorRe.exec(body);
    if (ctorMatch) {
      const ctorOpen = body.indexOf("{", ctorRe.lastIndex);
      if (ctorOpen >= 0) {
        const ctorClose = findMatchingBrace(body, ctorOpen);
        if (ctorClose > ctorOpen) {
          const ctorBody = body.slice(ctorOpen + 1, ctorClose);
          const thisFieldRe = /\bthis\.([A-Za-z_$][\w$]*)\s*=/g;
          let fm: RegExpExecArray | null = null;
          while ((fm = thisFieldRe.exec(ctorBody))) fields.add(fm[1]);
        }
      }
    }

    out.push({ name, fields: Array.from(fields).sort() });
    classRe.lastIndex = bodyClose + 1;
  }

  return out;
}

export default function GraphPane() {
  const trace = useTraceStore((s) => s.trace);
  const code = useCodeStore((s) => s.code);
  const sampleRevision = useCodeStore((s) => s.sampleRevision);
  const maxStep = Math.max(0, trace.steps.length - 1);

  const nodePos = useGraphStore((s) => s.nodePos);
  const resetPos = useGraphStore((s) => s.resetPos);

  const step = useUIStore((s) => s.selectedStep);
  const setStep = useUIStore((s) => s.setSelectedStep);
  const setSelectedCheckpointId = useUIStore((s) => s.setSelectedCheckpointId);
  const selectedVarName = useUIStore((s) => s.selectedVarName);
  const setSelectedVarName = useUIStore((s) => s.setSelectedVarName);
  const edgeCurveOverridesRef = useRef<Record<string, EdgeCurveOverride>>({});
  const [layoutRedrawRevision, setLayoutRedrawRevision] = useState(0);
  const [collapsedFields, setCollapsedFields] = useState<Record<string, true>>({});
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
  const [hiddenClasses, setHiddenClasses] = useState<Record<string, true>>({});
  const [hiddenRootVarArrows, setHiddenRootVarArrows] = useState<Record<string, true>>({});
  const [showNulls, setShowNulls] = useState(true);
  const [highlightNulls, setHighlightNulls] = useState(false);
  const [highlightUndefined, setHighlightUndefined] = useState(false);
  const [highlightNaNValue, setHighlightNaNValue] = useState(false);
  const [highlightedClasses, setHighlightedClasses] = useState<Record<string, true>>({});
  const [highlightedFields, setHighlightedFields] = useState<Record<string, true>>({});
  const [notInterestedClasses, setNotInterestedClasses] = useState<Record<string, true>>({});
  const [redrawHovered, setRedrawHovered] = useState(false);
  const [overlayPos, setOverlayPos] = useState<{ top: number; left: number } | null>(null);
  const graphAreaRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayDragRef = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);
  const layoutMemoryRef = useRef<Record<string, { x: number; y: number }>>({});
  const shouldAutoAlignStepRef = useRef(true);

  // Flush GraphPane local UI state on sample switch.
  useEffect(() => {
    edgeCurveOverridesRef.current = {};
    setCollapsedFields({});
    setExpandedClasses({});
    setHiddenClasses({});
    setHiddenRootVarArrows({});
    setShowNulls(true);
    setHighlightNulls(false);
    setHighlightUndefined(false);
    setHighlightNaNValue(false);
    setHighlightedClasses({});
    setHighlightedFields({});
    setNotInterestedClasses({});
    layoutMemoryRef.current = {};
    shouldAutoAlignStepRef.current = true;
    resetPos();
  }, [sampleRevision, resetPos]);

  useEffect(() => {
    if (!shouldAutoAlignStepRef.current) return;
    if (trace.steps.length <= 1) return;
    const targetStep = Math.max(0, trace.steps.length - 1); // last index
    const checkpointId = trace.steps[targetStep]?.checkpointId ?? null;
    setStep(targetStep);
    setSelectedCheckpointId(checkpointId);
    shouldAutoAlignStepRef.current = false;
  }, [trace.steps, setStep, setSelectedCheckpointId]);

  const clamp = useCallback((n: number) => Math.max(0, Math.min(maxStep, n)), [maxStep]);
  const prev = useCallback(() => setStep(clamp(step - 1)), [step, clamp, setStep]);
  const next = useCallback(() => setStep(clamp(step + 1)), [step, clamp, setStep]);

  // キーボード
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const isTypingTarget =
        tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable;
      if (isTypingTarget) return;

      if (e.key === "j") {
        e.preventDefault();
        prev();
      } else if (e.key === "k") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prev, next]);

  const state = useMemo(() => getStateAt(trace, clamp(step)), [trace, step, clamp]);
  const currentStepMeta = trace.steps[clamp(step)];
  const classSummaries = useMemo(() => extractClassSummaries(code), [code]);
  const classNameSet = useMemo(
    () => new Set(classSummaries.map((c) => c.name)),
    [classSummaries]
  );
  const shouldShowRootVar = useCallback(
    (name: string) => !isInternalVarName(name) && !classNameSet.has(name),
    [classNameSet]
  );
  const availableVarNames = useMemo(() => {
    const fromTrace = currentStepMeta?.varNames ?? Object.keys(state.roots);
    const out = fromTrace.filter((n) => shouldShowRootVar(n));
    out.sort();
    return out;
  }, [currentStepMeta?.varNames, state.roots, shouldShowRootVar]);
  const collapseKey = useCallback((className: string, fieldName: string) => `${className}::${fieldName}`, []);
  const isHiddenObj = useCallback(
    (objId: string) => {
      const cn = state.objects[objId]?.className;
      return !!cn && !!hiddenClasses[cn];
    },
    [state.objects, hiddenClasses]
  );
  const isFieldCollapsedForObject = useCallback(
    (objClassName: string | undefined, fieldName: string) =>
      !!objClassName && !!collapsedFields[collapseKey(objClassName, fieldName)],
    [collapsedFields, collapseKey]
  );
  const isFieldHighlightedForObject = useCallback(
    (objClassName: string | undefined, fieldName: string) =>
      !!objClassName && !!highlightedFields[collapseKey(objClassName, fieldName)],
    [highlightedFields, collapseKey]
  );
  const danglingObjRefs = useMemo(() => {
    const missing = new Set<string>();

    for (const [name, v] of Object.entries(state.roots)) {
      if (!shouldShowRootVar(name)) continue;
      if (v.kind === "obj" && !state.objects[v.id]) {
        missing.add(`root:${name} -> ${v.id}`);
      }
    }

    for (const o of Object.values(state.objects)) {
      for (const [k, v] of Object.entries(o.props)) {
        if (v.kind === "obj" && !state.objects[v.id]) {
          missing.add(`${o.id}.${k} -> ${v.id}`);
        }
      }
    }

    return Array.from(missing).sort();
  }, [state, shouldShowRootVar]);
  const lastDanglingDigestRef = useRef("");

  useEffect(() => {
    const digest = `${step}|${currentStepMeta?.checkpointId ?? ""}|${danglingObjRefs.join("|")}`;
    if (digest === lastDanglingDigestRef.current) return;
    lastDanglingDigestRef.current = digest;

    if (danglingObjRefs.length > 0) {
      console.warn("[GraphPane] dangling object refs detected", {
        step,
        checkpointId: currentStepMeta?.checkpointId ?? null,
        refs: danglingObjRefs,
      });
    }
  }, [danglingObjRefs, step, currentStepMeta?.checkpointId]);

  // step → checkpointId sync
  useEffect(() => {
    const checkpointId = trace.steps[clamp(step)]?.checkpointId ?? null;
    setSelectedCheckpointId(checkpointId);
  }, [trace, step, clamp, setSelectedCheckpointId]);

  // ===== 表示対象の reachability を計算（internal roots は起点にしない）=====
  const reachableObjIds = useMemo(() => {
    const q: string[] = [];
    const seen = new Set<string>();

    for (const [name, v] of Object.entries(state.roots)) {
      if (!shouldShowRootVar(name)) continue;
      if (v.kind === "obj") {
        if (isHiddenObj(v.id)) continue;
        q.push(v.id);
        seen.add(v.id);
      }
    }

    while (q.length) {
      const oid = q.pop()!;
      const o = state.objects[oid];
      if (!o) continue;
      for (const vv of Object.values(o.props)) {
        if (vv.kind === "obj" && !seen.has(vv.id) && !isHiddenObj(vv.id)) {
          seen.add(vv.id);
          q.push(vv.id);
        }
      }
    }

    return seen;
  }, [state.roots, state.objects, shouldShowRootVar, isHiddenObj]);

  const legacySeedPositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const id of reachableObjIds) {
      const mem = layoutMemoryRef.current[id];
      if (mem) {
        m.set(id, mem);
        continue;
      }
      const p = nodePos[id];
      if (p) m.set(id, p);
    }
    return m;
  }, [reachableObjIds, nodePos, layoutRedrawRevision]);

  const redrawLayout = useCallback(() => {
    edgeCurveOverridesRef.current = {};
    layoutMemoryRef.current = {};
    didFitRef.current = false;
    lastNodeCountRef.current = 0;
    resetPos();
    setLayoutRedrawRevision((v) => v + 1);
  }, [resetPos]);

  const structuralLayoutHints = useMemo(
    () => buildStructuralLayoutHints(state, reachableObjIds, isHiddenObj, legacySeedPositions),
    [state, reachableObjIds, isHiddenObj, legacySeedPositions]
  );

  const valueNodeHints = useMemo(
    () => buildValueNodeHints(state, structuralLayoutHints, reachableObjIds, isHiddenObj),
    [state, structuralLayoutHints, reachableObjIds, isHiddenObj]
  );
  const legacyFieldAngles = useMemo(
    () => buildLegacyFieldAngles(state, reachableObjIds, isHiddenObj),
    [state, reachableObjIds, isHiddenObj]
  );
  const legacySuppressedAngleSignatures = useMemo(
    () => buildLegacyAngleSuppressionSet(state, reachableObjIds, isHiddenObj),
    [state, reachableObjIds, isHiddenObj]
  );
  const legacyCycleEdgeSet = useMemo(
    () => buildLegacyCycleEdgeSet(state, reachableObjIds, isHiddenObj),
    [state, reachableObjIds, isHiddenObj]
  );
  const legacyObjectLayout = useMemo(
    () =>
      buildLegacyObjectLayout({
        state,
        reachableObjIds,
        isHiddenObj,
        seeds: legacySeedPositions,
        structuralHints: structuralLayoutHints,
        fieldAngles: legacyFieldAngles,
        cycleEdgeSet: legacyCycleEdgeSet,
        suppressedAngleSignatures: legacySuppressedAngleSignatures,
        notInterestedClasses,
      }),
    [
      state,
      reachableObjIds,
      isHiddenObj,
      legacySeedPositions,
      structuralLayoutHints,
      legacyFieldAngles,
      legacyCycleEdgeSet,
      legacySuppressedAngleSignatures,
      notInterestedClasses,
    ]
  );

  // ===== ノード/エッジ生成（変数はエッジのみ。rootノードは透明アンカー）=====
  const { nodes, edges } = useMemo<{ nodes: VisNode[]; edges: VisEdge[] }>(() => {
    const nodes: VisNode[] = [];
    const edges: VisEdge[] = [];
    const edgeLabelFontSize = (args: {
      classDeemphasized?: boolean;
      targetClassDeemphasized?: boolean;
      isPrimitiveOrNull?: boolean;
      isRoot?: boolean;
    }) => {
      const { classDeemphasized, targetClassDeemphasized, isPrimitiveOrNull, isRoot } = args;
      let scale = 1;
      if (isRoot) scale *= 0.96;
      if (isPrimitiveOrNull) scale *= 0.92;
      if (classDeemphasized) scale *= 0.9;
      if (targetClassDeemphasized) scale *= 0.86;
      return Math.max(7, Math.round(LEGACY_FIFA.edgeFontSize * scale));
    };

    const primNodeId = (objId: string, key: string) => `p:${objId}:${key}`;
    const rootPrimId = (name: string) => `p:root:${name}`;
    const rootVarAnchorId = (name: string) => `__var:${name}`;

    // --- roots (透明アンカー + 変数名はエッジラベル) ---
    const rootNames = Object.keys(state.roots)
      .filter((n) => shouldShowRootVar(n))
      .sort();

    rootNames.forEach((name, i) => {
      const anchorId = rootVarAnchorId(name);
      const fallbackPos = { x: 60 + i * 120, y: 0 };
      const pos = nodePos[anchorId] ?? fallbackPos;

      // Hidden variable endpoint (free end) for root green edges.
      nodes.push({
        id: anchorId,
        label: name,
        x: pos.x,
        y: pos.y,
        group: "rootAnchor",
        shape: "dot",
        size: 1,
        fixed: false,
        physics: true,
        color: { background: "rgba(0,0,0,0)", border: "rgba(0,0,0,0)" },
        font: { size: 1, color: "rgba(0,0,0,0)" },
      });

      const v = state.roots[name];
      const hideRootArrow = !!hiddenRootVarArrows[name];

      if (v.kind === "obj") {
        if (!state.objects[v.id]) return;
        if (!reachableObjIds.has(v.id)) return; // 念のため
        if (hideRootArrow) return;
        const isFocusedVar = selectedVarName === name;
        edges.push({
          id: `${anchorId}->${v.id}`,
          from: anchorId,
          to: v.id,
          label: name, // ★変数名はエッジだけ
          arrows: "to",
          width: isFocusedVar ? 6 : 3,
          length: LEGACY_FIFA.variableEdgeLength,
          color: getLegacyEdgeColor({
            highlighted: false,
            classDeemphasized: false,
            isPrimitiveOrNull: false,
            isRoot: true,
            isFocusedRoot: isFocusedVar,
          }),
          font: { size: edgeLabelFontSize({ isRoot: true }), align: "middle" },
          data: { kind: "root", name },
        });
      } else {
        // root が prim の場合：literalノード + 変数名エッジ
        if (v.v === null && !showNulls) return;
        const pid = rootPrimId(name);
        const pFallback = { x: pos.x + 160, y: pos.y };
        const ppos = nodePos[pid] ?? pFallback;

        nodes.push({
          id: pid,
          label: litLabel(v.v),
          x: ppos.x,
          y: ppos.y,
          group: "prim",
          shape: "circle",
          size: 18,
          font: { size: 10, color: "#1e2933" },
          color:
            v.v === null && highlightNulls
              ? { background: "#ffb3b3", border: "#d84a4a" }
              : isUndefinedValue(v.v) && highlightUndefined
                ? { background: "#ffe7b8", border: "#d18a1b" }
                : isNaNValue(v.v) && highlightNaNValue
                  ? { background: "#ffd9f3", border: "#c04a9b" }
              : { background: "#ffffff", border: "#cfd6de" },
          margin: { top: 2, right: 6, bottom: 2, left: 6 },
        });

        if (!hideRootArrow) {
          const isFocusedVar = selectedVarName === name;
          edges.push({
            id: `${anchorId}-${name}-${pid}`,
            from: anchorId,
            to: pid,
            label: name,
            arrows: "to",
            width: isFocusedVar ? 6 : 3,
            length: LEGACY_FIFA.variableEdgeLength,
            color: getLegacyEdgeColor({
              highlighted: false,
              classDeemphasized: false,
              isPrimitiveOrNull: true,
              isRoot: true,
              isFocusedRoot: isFocusedVar,
            }),
            font: { size: edgeLabelFontSize({ isRoot: true, isPrimitiveOrNull: true }), align: "middle" },
            data: { kind: "root", name },
          });
        }
      }
    });

    // --- objects + edges (reachable のみ表示) ---
    const objs = Object.values(state.objects).filter((o) => reachableObjIds.has(o.id) && !isHiddenObj(o.id));

    const objBasePos = new Map<string, { x: number; y: number }>();
    objs.forEach((o, idx) => {
      const fallbackPos = { x: 80 + idx * 160, y: 140 };
      objBasePos.set(o.id, legacyObjectLayout.get(o.id) ?? structuralLayoutHints.get(o.id) ?? fallbackPos);
    });
    const objBasePosWithPushdown = applyRegionPushdownForLegacyStructures(
      state,
      reachableObjIds,
      isHiddenObj,
      structuralLayoutHints,
      objBasePos
    );
    const forcedValTargetPosById = new Map<string, { x: number; y: number }>();
    const TREE_VAL_OFFSET_Y = 75;
    for (const o of objs) {
      const parentPos = objBasePosWithPushdown.get(o.id) ?? objBasePos.get(o.id);
      if (!parentPos) continue;
      const hasTreeShape = Object.prototype.hasOwnProperty.call(o.props, "left")
        || Object.prototype.hasOwnProperty.call(o.props, "right");
      if (!hasTreeShape) continue;
      const vv = o.props.val;
      if (!vv) continue;
      if (vv.kind === "obj") {
        if (!state.objects[vv.id]) continue;
        if (!reachableObjIds.has(vv.id)) continue;
        forcedValTargetPosById.set(vv.id, {
          x: parentPos.x,
          y: parentPos.y + TREE_VAL_OFFSET_Y,
        });
      } else if (vv.v === null) {
        forcedValTargetPosById.set(`n:${o.id}:val`, {
          x: parentPos.x,
          y: parentPos.y + TREE_VAL_OFFSET_Y,
        });
      } else {
        forcedValTargetPosById.set(`p:${o.id}:val`, {
          x: parentPos.x,
          y: parentPos.y + TREE_VAL_OFFSET_Y,
        });
      }
    }

    const collapsedPlacementByNodeId = new Map<string, { x: number; y: number }>();
    const collapsedHighlightNodeIds = new Set<string>();
    for (const o of objs) {
      const props = Object.entries(o.props).sort(([a], [b]) => a.localeCompare(b));
      const parentPos = objBasePos.get(o.id)!;
      let collapsedSlot = 0;
      for (const [k, v] of props) {
        if (!isFieldCollapsedForObject(o.className, k)) continue;

        collapsedHighlightNodeIds.add(o.id);
        const dx = 120 + (collapsedSlot % 3) * 86;
        const dy = -22 + Math.floor(collapsedSlot / 3) * 52;
        collapsedSlot++;

        if (v.kind === "obj") {
          if (!state.objects[v.id]) continue;
          if (!reachableObjIds.has(v.id)) continue;
          collapsedHighlightNodeIds.add(v.id);
          collapsedPlacementByNodeId.set(v.id, { x: parentPos.x + dx, y: parentPos.y + dy });
        } else {
          if (v.v === null) {
            collapsedPlacementByNodeId.set(`n:${o.id}:${k}`, {
              x: parentPos.x + dx,
              y: parentPos.y + dy,
            });
          } else {
            collapsedPlacementByNodeId.set(`p:${o.id}:${k}`, {
              x: parentPos.x + dx,
              y: parentPos.y + dy,
            });
          }
        }
      }
    }

    objs.forEach((o, idx) => {
      const fallbackPos = { x: 80 + idx * 160, y: 140 };
      const pos = collapsedPlacementByNodeId.get(o.id)
        ?? forcedValTargetPosById.get(o.id)
        ?? objBasePosWithPushdown.get(o.id)
        ?? nodePos[o.id]
        ?? fallbackPos;

      const props = Object.entries(o.props).sort(([a], [b]) => a.localeCompare(b));
      const isArrayObj = o.objKind === "array";
      const regularProps = isArrayObj
        ? props.filter(([k]) => !isArrayIndexKey(k))
        : props;
      const propsForEdges = isArrayObj ? props : regularProps;
      const label =
        o.className ??
        (o.objKind === "array"
          ? "Array"
          : o.objKind === "function"
            ? "Function"
            : o.objKind === "class"
              ? "Class"
              : "Object");
      const parentClassName = label;
      const collapseHighlighted = collapsedHighlightNodeIds.has(o.id);
      const classHighlighted = !!o.className && !!highlightedClasses[o.className];
      const classDeemphasized = !!o.className && !!notInterestedClasses[o.className];
      const fieldHighlighted = props.some(([k]) => isFieldHighlightedForObject(o.className, k));
      const fontSize = Math.max(9, Math.round(11 * (classDeemphasized ? 0.86 : 1)));
      const dimOpacity = classDeemphasized ? 0.65 : 1;

      nodes.push({
        id: o.id,
        label,
        x: pos.x,
        y: pos.y,
        group: collapseHighlighted ? "objHighlight" : "obj",
        shape: "box",
        font: { size: fontSize, color: classDeemphasized ? "#d6dfeb" : undefined },
        borderWidth: collapseHighlighted || classHighlighted || fieldHighlighted ? 2 : 1.2,
        color: classHighlighted
          ? { background: "#7ed491", border: "#2f8f3f" }
          : {
              background: classDeemphasized ? "rgba(120, 136, 155, 0.6)" : "#97c2fc",
              border: fieldHighlighted ? "#3aa95b" : collapseHighlighted ? "#7f95ad" : "#2b7ce9",
            },
        opacity: dimOpacity,
        margin: { top: 4, right: 8, bottom: 4, left: 8 },
      });

      let primIndex = 0;
      let nullIndex = 0;
      for (const [k, v] of propsForEdges) {
        if (isFieldCollapsedForObject(o.className, k)) {
          continue; // collapsed: hide this field edge and place target node adjacent to parent
        }

        if (v.kind === "obj") {
          if (!state.objects[v.id]) continue;
          if (!reachableObjIds.has(v.id)) continue;
          const isListNext = k === "next";
          const isTreeBranch = k === "left" || k === "right";
          const isStructuredEdge = isListNext || isTreeBranch;
          const structuredSmooth = getLegacyStructuredEdgeSmooth(k);
          const toObj = state.objects[v.id]!;
          const toClassDeemphasized = !!(toObj.className && notInterestedClasses[toObj.className]);
          const deemphTuning = getLegacyDeemphasisEdgeTuning({
            fromClassName: o.className,
            toClassName: toObj.className,
            notInterestedClasses,
            targetIsPrimitiveOrNull: false,
          });
          const baseLength = getLegacyEdgeLength({
            key: k,
            isArrayObj,
            isPrimitiveOrNull: false,
            classDeemphasized,
          });
          const tunedLength = Math.max(14, Math.round(baseLength * deemphTuning.lengthMultiplier));
          const baseSmooth = isStructuredEdge
            ? (structuredSmooth?.enabled === false
              ? { enabled: false, type: "dynamic", roundness: 0 }
              : {
                  enabled: true,
                  type: "dynamic",
                  roundness: 0.08,
                })
            : {
                enabled: true,
                type: "dynamic",
                roundness: 0.08,
              };
          const edgeSmooth = deemphTuning.smoothEnabled
            ? baseSmooth
            : { enabled: false, type: "dynamic", roundness: 0 };

          edges.push({
            id: `${o.id}-${k}-${v.id}`,
            from: o.id,
            to: v.id,
            label: isArrayObj && isArrayIndexKey(k) ? `[${k}]` : k,
            arrows: "to",
            smooth: edgeSmooth,
            width: isFieldHighlightedForObject(o.className, k) ? 4 : 1,
            length: tunedLength,
            color: getLegacyEdgeColor({
              highlighted: isFieldHighlightedForObject(o.className, k),
              classDeemphasized,
              isPrimitiveOrNull: false,
            }),
            font: {
              size: edgeLabelFontSize({
                classDeemphasized,
                targetClassDeemphasized: toClassDeemphasized,
              }),
              align: "middle",
            },
            data: { kind: "prop", key: k, ownerObjId: o.id },
          });
        } else {
          if (v.v === null) {
            if (!showNulls) continue;
            const nid = `n:${o.id}:${k}`;
            const nullIdealAngle = getLegacyFieldIdealAngle({
              key: k,
              fromClass: parentClassName,
              childClass: "null",
              fieldAngles: legacyFieldAngles,
            });
            const nullLengthBase = getLegacyEdgeLength({
              key: k,
              isArrayObj,
              isPrimitiveOrNull: true,
              classDeemphasized,
            });
            const nullRad = (nullIdealAngle ?? 32) * Math.PI / 180;
            const nullRadius = Math.max(40, Math.round(nullLengthBase * 0.72));
            const nFallback = {
              x: pos.x + Math.cos(nullRad) * nullRadius + ((nullIndex % 3) - 1) * 8,
              y: pos.y + Math.sin(nullRad) * nullRadius + Math.floor(nullIndex / 3) * 18,
            };
            nullIndex++;
            const npos = forcedValTargetPosById.get(nid) ?? nodePos[nid] ?? valueNodeHints.get(nid) ?? nFallback;
            const nPosCollapsed = collapsedPlacementByNodeId.get(nid);

            nodes.push({
              id: nid,
              label: "null",
              x: (nPosCollapsed ?? npos).x,
              y: (nPosCollapsed ?? npos).y,
              group: "null",
              shape: "box",
              font: { size: 10, color: "#111827" },
              color: highlightNulls
                ? { background: "#a32626", border: "#ff8a8a" }
                : { background: "#d7dde6", border: "#a8b3c1" },
              margin: { top: 2, right: 6, bottom: 2, left: 6 },
            });

            edges.push({
              id: `${o.id}-${k}-${nid}`,
              from: o.id,
              to: nid,
              label: isArrayObj && isArrayIndexKey(k) ? `[${k}]` : k,
              arrows: "to",
              dashes: true,
              smooth: (() => {
                const structured = getLegacyStructuredEdgeSmooth(k);
                if (structured) {
                  if (structured.enabled === false) return structured;
                  return {
                    enabled: true,
                    type: "dynamic",
                    roundness: 0.08,
                  };
                }
                const baseSmooth = {
                  enabled: true,
                  type: "dynamic",
                  roundness: 0.08,
                };
                const tuning = getLegacyDeemphasisEdgeTuning({
                  fromClassName: o.className,
                  toClassName: undefined,
                  notInterestedClasses,
                  targetIsPrimitiveOrNull: true,
                });
                return tuning.smoothEnabled
                  ? baseSmooth
                  : { enabled: false, type: "dynamic", roundness: 0 };
              })(),
              width: isFieldHighlightedForObject(o.className, k) ? 4 : 2,
              length: (() => {
                const base = getLegacyEdgeLength({
                  key: k,
                  isArrayObj,
                  isPrimitiveOrNull: true,
                  classDeemphasized,
                });
                const tuning = getLegacyDeemphasisEdgeTuning({
                  fromClassName: o.className,
                  toClassName: undefined,
                  notInterestedClasses,
                  targetIsPrimitiveOrNull: true,
                });
                return Math.max(12, Math.round(base * tuning.lengthMultiplier));
              })(),
              color: getLegacyEdgeColor({
                highlighted: isFieldHighlightedForObject(o.className, k),
                classDeemphasized,
                isPrimitiveOrNull: true,
              }),
              font: {
                size: edgeLabelFontSize({
                  classDeemphasized,
                  isPrimitiveOrNull: true,
                }),
                align: "middle",
              },
              data: { kind: "prop", key: k, isNull: true, ownerObjId: o.id },
            });
            continue;
          }
          const pid = primNodeId(o.id, k);
          const primChildClass = `primitive:${typeof v.v}`;
          const primIdealAngle = getLegacyFieldIdealAngle({
            key: k,
            fromClass: parentClassName,
            childClass: primChildClass,
            fieldAngles: legacyFieldAngles,
          });
          const primLengthBase = getLegacyEdgeLength({
            key: k,
            isArrayObj,
            isPrimitiveOrNull: true,
            classDeemphasized,
          });
          const primRad = (primIdealAngle ?? 28) * Math.PI / 180;
          const primRadius = Math.max(38, Math.round(primLengthBase * 0.74));
          const pFallback = {
            x: pos.x + Math.cos(primRad) * primRadius + ((primIndex % 3) - 1) * 9,
            y: pos.y + Math.sin(primRad) * primRadius + Math.floor(primIndex / 3) * 18,
          };
          primIndex++;
          const ppos = forcedValTargetPosById.get(pid) ?? nodePos[pid] ?? valueNodeHints.get(pid) ?? pFallback;
          const pPosCollapsed = collapsedPlacementByNodeId.get(pid);

          nodes.push({
            id: pid,
            label: litLabel(v.v),
            x: (pPosCollapsed ?? ppos).x,
            y: (pPosCollapsed ?? ppos).y,
            group: "prim",
            shape: "circle",
            size: 18,
            font: { size: 10, color: "#1e2933" },
            color:
              isUndefinedValue(v.v) && highlightUndefined
                ? { background: "#ffe7b8", border: "#d18a1b" }
                : isNaNValue(v.v) && highlightNaNValue
                  ? { background: "#ffd9f3", border: "#c04a9b" }
                  : { background: "#ffffff", border: "#cfd6de" },
            margin: { top: 2, right: 6, bottom: 2, left: 6 },
          });

          edges.push({
            id: `${o.id}-${k}-${pid}`,
            from: o.id,
            to: pid,
            label: isArrayObj && isArrayIndexKey(k) ? `[${k}]` : k,
            arrows: "to",
            width: isFieldHighlightedForObject(o.className, k) ? 4 : 1,
            smooth: (() => {
              const structured = getLegacyStructuredEdgeSmooth(k);
              if (structured) {
                if (structured.enabled === false) return structured;
                return {
                  enabled: true,
                  type: "dynamic",
                  roundness: 0.08,
                };
              }
              const baseSmooth = {
                enabled: true,
                type: "dynamic",
                roundness: 0.08,
              };
              const tuning = getLegacyDeemphasisEdgeTuning({
                fromClassName: o.className,
                toClassName: undefined,
                notInterestedClasses,
                targetIsPrimitiveOrNull: true,
              });
              return tuning.smoothEnabled
                ? baseSmooth
                : { enabled: false, type: "dynamic", roundness: 0 };
            })(),
            length: (() => {
              const base = getLegacyEdgeLength({
                key: k,
                isArrayObj,
                isPrimitiveOrNull: true,
                classDeemphasized,
              });
              const tuning = getLegacyDeemphasisEdgeTuning({
                fromClassName: o.className,
                toClassName: undefined,
                notInterestedClasses,
                targetIsPrimitiveOrNull: true,
              });
              return Math.max(12, Math.round(base * tuning.lengthMultiplier));
            })(),
            color: getLegacyEdgeColor({
              highlighted: isFieldHighlightedForObject(o.className, k),
              classDeemphasized,
              isPrimitiveOrNull: true,
            }),
            font: {
              size: edgeLabelFontSize({
                classDeemphasized,
                isPrimitiveOrNull: true,
              }),
              align: "middle",
            },
            data: { kind: "prop", key: k, ownerObjId: o.id },
          });
        }
      }
    });

    return { nodes, edges };
  }, [state, nodePos, reachableObjIds, shouldShowRootVar, selectedVarName, isFieldCollapsedForObject, isHiddenObj, hiddenRootVarArrows, showNulls, highlightedClasses, highlightNulls, highlightUndefined, highlightNaNValue, isFieldHighlightedForObject, structuralLayoutHints, notInterestedClasses, valueNodeHints, legacyFieldAngles, legacyCycleEdgeSet, legacySuppressedAngleSignatures, legacyObjectLayout]);

  const edgesWithOverrides = useMemo(() => {
    return edges.map((e) => {
      const key = String((e as any)?.data?.key ?? "");
      if (key === "left" || key === "right") return e;
      const ov = edgeCurveOverridesRef.current[e.id];
      if (!ov) return e;
      return {
        ...e,
        smooth: { enabled: true, type: ov.type, roundness: ov.roundness },
      };
    });
  }, [edges]);

  // ===== vis-network 本体 =====
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDSRef = useRef(new DataSet<VisNode>([]));
  const edgesDSRef = useRef(new DataSet<VisEdge>([]));

  const didFitRef = useRef(false);
  const lastNodeCountRef = useRef(0);
  const edgeWobbleRafRef = useRef<Record<string, number>>({});

  const handleEdgeClick = useCallback(
    (edge: any) => {
      if (!edge) return;

      if (edge?.data?.kind === "root") {
        const name = String(edge.data.name);
        setSelectedVarName(name);
        const lw = state.lastWrite[`root:${name}`];
        if (!lw) return;
        setSelectedCheckpointId(lw.checkpointId ?? null);
        setStep(lw.stepId);
        return;
      }

      const key = String(edge?.data?.key ?? edge?.label ?? "");
      const ownerObjId = String(edge?.data?.ownerObjId ?? edge.from ?? "");
      const lk = `${ownerObjId}:${key}`;
      const lw = state.lastWrite[lk];
      if (!lw) return;
      setSelectedCheckpointId(lw.checkpointId ?? null);
      setStep(lw.stepId);
    },
    [state.lastWrite, setSelectedCheckpointId, setStep, setSelectedVarName]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    if (networkRef.current) return;

    const data = { nodes: nodesDSRef.current, edges: edgesDSRef.current };

    const options: any = {
      autoResize: true,
      layout: {
        improvedLayout: true,
      },
      physics: getLegacyPhysicsOptions(),
      interaction: {
        hover: true,
        navigationButtons: true,
        keyboard: { enabled: true },
      },
      nodes: {
        shape: "box",
        font: { size: 11 },
        size: LEGACY_FIFA.nodeSize,
        margin: { top: 4, right: 8, bottom: 4, left: 8 },
      },
      edges: {
        length: Math.round(LEGACY_FIFA.standardEdgeLength * 0.9),
        width: 3,
        color: {
          inherit: false,
          color: "#b7c1ce",
          highlight: "#d3dbe6",
          hover: "#d3dbe6",
        },
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        font: { size: LEGACY_FIFA.edgeFontSize, align: "middle" },
        smooth: { enabled: true, type: "dynamic", roundness: 0.08 },
      },
      groups: {
        rootAnchor: {
          shape: "dot",
          size: 1,
          color: { background: "rgba(0,0,0,0)", border: "rgba(0,0,0,0)" },
          font: { size: 1, color: "rgba(0,0,0,0)" },
        },
        obj: { shape: "box", font: { size: 11 } },
        objHighlight: {
          shape: "box",
          font: { size: 11 },
          borderWidth: 2,
          color: { background: "#24323f", border: "#ffd166" },
        },
        prim: {
          shape: "circle",
          size: 18,
          color: { background: "#ffffff", border: "#cfd6de" },
          font: { size: 10, color: "#1e2933" },
          margin: { top: 2, right: 6, bottom: 2, left: 6 },
        },
        null: {
          shape: "box",
          color: { background: "#d7dde6", border: "#a8b3c1" },
          font: { size: 10, color: "#111827" },
          margin: { top: 2, right: 6, bottom: 2, left: 6 },
        },
      },
    };

    const network = new Network(containerRef.current, data as any, options);
    networkRef.current = network;

    const registerCurrentPositions = (ids?: string[]) => {
      const targetIds = ids ?? ((nodesDSRef.current.getIds() as Array<string | number>).map(String));
      if (!targetIds.length) return;
      const positions = network.getPositions(targetIds);
      for (const id of targetIds) {
        const p = positions[id];
        if (!p) continue;
        layoutMemoryRef.current[id] = { x: p.x, y: p.y };
      }
    };
    const setNodesFixed = (fixed: boolean, ids?: string[]) => {
      const targetIds = ids ?? ((nodesDSRef.current.getIds() as Array<string | number>).map(String));
      for (const id of targetIds) {
        if (id.startsWith("__var:")) continue;
        const node = nodesDSRef.current.get(id as any) as any;
        if (!node) continue;
        nodesDSRef.current.update({ id, fixed: { x: fixed, y: fixed } } as any);
      }
    };
    const updateEdgeSmooth = (edgeId: string, smooth: { enabled: boolean; type: string; roundness: number }) => {
      const edge = edgesDSRef.current.get(edgeId as any) as any;
      if (!edge) return;
      edgesDSRef.current.update({ id: edgeId, smooth } as any);
    };
    const normalizeSmooth = (edge: any): { enabled: boolean; type: string; roundness: number } => {
      const s = edge?.smooth;
      const enabled = s?.enabled ?? true;
      const type = typeof s?.type === "string" ? s.type : "dynamic";
      const roundness = typeof s?.roundness === "number" ? s.roundness : 0.2;
      return { enabled, type, roundness };
    };
    const stopEdgeWobble = (edgeId: string) => {
      const raf = edgeWobbleRafRef.current[edgeId];
      if (!raf) return;
      cancelAnimationFrame(raf);
      delete edgeWobbleRafRef.current[edgeId];
    };
    const startEdgeWobble = (edgeId: string, ov: EdgeCurveOverride) => {
      stopEdgeWobble(edgeId);
      const started = performance.now();
      const durationMs = 520;
      const base = ov.roundness;
      const amp = Math.min(0.12, Math.max(0.03, base * 0.35));
      const freq = 0.03;
      const tick = (now: number) => {
        const t = now - started;
        const p = Math.min(1, t / durationMs);
        const decay = 1 - p;
        const wave = Math.sin(t * freq) * amp * decay;
        const roundness = Math.max(0.05, Math.min(0.95, base + wave));
        updateEdgeSmooth(edgeId, { enabled: true, type: ov.type, roundness });
        if (p >= 1) {
          updateEdgeSmooth(edgeId, { enabled: true, type: ov.type, roundness: base });
          delete edgeWobbleRafRef.current[edgeId];
          return;
        }
        edgeWobbleRafRef.current[edgeId] = requestAnimationFrame(tick);
      };
      edgeWobbleRafRef.current[edgeId] = requestAnimationFrame(tick);
    };
    const hoverNodeIds: string[] = [];
    const hoverEdgeIds: string[] = [];
    const hoverNodeColors = new Map<string, any>();
    const hoverEdgeColors = new Map<string, any>();
    const toHoverNodeColor = (base: any) => {
      if (base && typeof base === "object" && ("background" in base || "border" in base)) {
        return {
          ...base,
          background: "#e5f8ea",
          border: "#2f8f3f",
          highlight: { ...(base.highlight ?? {}), background: "#e5f8ea", border: "#2f8f3f" },
          hover: { ...(base.hover ?? {}), background: "#e5f8ea", border: "#2f8f3f" },
        };
      }
      return {
        background: "#e5f8ea",
        border: "#2f8f3f",
        highlight: { background: "#e5f8ea", border: "#2f8f3f" },
        hover: { background: "#e5f8ea", border: "#2f8f3f" },
      };
    };
    const clearHoverPath = () => {
      while (hoverNodeIds.length > 0) {
        const id = hoverNodeIds.pop()!;
        const color = hoverNodeColors.get(id);
        if (color !== undefined) {
          nodesDSRef.current.update({ id, color } as any);
        }
      }
      hoverNodeColors.clear();
      while (hoverEdgeIds.length > 0) {
        const id = hoverEdgeIds.pop()!;
        const color = hoverEdgeColors.get(id);
        if (color !== undefined) {
          edgesDSRef.current.update({ id, color } as any);
        }
      }
      hoverEdgeColors.clear();
    };
    const highlightHoverPath = (startNodeId: string) => {
      clearHoverPath();
      const visitedNodes = new Set<string>([startNodeId]);
      const visitedEdges = new Set<string>();
      const q: string[] = [startNodeId];
      while (q.length > 0) {
        const current = q.shift()!;
        const edgeIds = network.getConnectedEdges(current) as Array<string | number>;
        edgeIds.forEach((eidRaw) => {
          const eid = String(eidRaw);
          const e = edgesDSRef.current.get(eid as any) as any;
          if (!e) return;
          if (String(e.from) !== current) return;
          visitedEdges.add(eid);
          const to = String(e.to);
          if (visitedNodes.has(to)) return;
          visitedNodes.add(to);
          q.push(to);
        });
      }

      visitedNodes.forEach((id) => {
        if (id.startsWith("__var:")) return;
        const node = nodesDSRef.current.get(id as any) as any;
        if (!node) return;
        hoverNodeIds.push(id);
        hoverNodeColors.set(id, node.color);
        nodesDSRef.current.update({ id, color: toHoverNodeColor(node.color) } as any);
      });
      visitedEdges.forEach((id) => {
        const edge = edgesDSRef.current.get(id as any) as any;
        if (!edge) return;
        hoverEdgeIds.push(id);
        hoverEdgeColors.set(id, edge.color);
        edgesDSRef.current.update({
          id,
          color: {
            color: "#5dff7a",
            highlight: "#74ff8d",
            hover: "#74ff8d",
          },
        } as any);
      });
    };

    const container = containerRef.current;
    let draggingEdgeId: string | null = null;
    let lastEdgeAtDown: string | null = null;
    let pendingEdgeOverride: EdgeCurveOverride | null = null;
    let lastSignedDist = 0;
    const influencedEdges = new Set<string>();
    const influencedBaseSmooth = new Map<string, { enabled: boolean; type: string; roundness: number }>();
    const applyEdgeInfluence = (draggedEdgeId: string, signedDist: number) => {
      const dragged = edgesDSRef.current.get(draggedEdgeId as any) as any;
      if (!dragged?.from || !dragged?.to) return;
      const endpoints = new Set<string>([String(dragged.from), String(dragged.to)]);
      const magnitude = Math.min(0.2, Math.abs(signedDist) / 260);
      const ids = (edgesDSRef.current.getIds() as Array<string | number>).map(String);
      for (const id of ids) {
        if (id === draggedEdgeId) continue;
        const edge = edgesDSRef.current.get(id as any) as any;
        if (!edge) continue;
        const key = String(edge?.data?.key ?? "");
        if (key === "left" || key === "right") continue;
        const shareEndpoint = endpoints.has(String(edge.from)) || endpoints.has(String(edge.to));
        if (!shareEndpoint) continue;

        if (!influencedBaseSmooth.has(id)) {
          influencedBaseSmooth.set(id, normalizeSmooth(edge));
        }
        const base = influencedBaseSmooth.get(id)!;
        const type = signedDist >= 0 ? "curvedCW" : "curvedCCW";
        const roundness = Math.max(0.06, Math.min(0.9, base.roundness + magnitude));
        updateEdgeSmooth(id, { enabled: true, type, roundness });
        influencedEdges.add(id);
      }
    };
    const resetEdgeInfluence = () => {
      influencedEdges.forEach((id) => {
        const base = influencedBaseSmooth.get(id);
        if (!base) return;
        updateEdgeSmooth(id, base);
      });
      influencedEdges.clear();
      influencedBaseSmooth.clear();
    };

    const onMouseDown = (ev: MouseEvent) => {
      const edgeId = network.getEdgeAt({ x: ev.offsetX, y: ev.offsetY } as any);
      if (!edgeId) return;
      const edge = edgesDSRef.current.get(edgeId as any) as any;
      const key = String(edge?.data?.key ?? "");
      if (key === "left" || key === "right") return;
      draggingEdgeId = String(edgeId);
      lastEdgeAtDown = draggingEdgeId;
      lastSignedDist = 0;
      container.style.cursor = "grabbing";
      ev.preventDefault();
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingEdgeId) return;
      const edge = edgesDSRef.current.get(draggingEdgeId as any) as any;
      if (!edge?.from || !edge?.to) return;

      const positions = network.getPositions([String(edge.from), String(edge.to)]);
      const a = positions[String(edge.from)];
      const b = positions[String(edge.to)];
      if (!a || !b) return;

      const p = network.DOMtoCanvas({ x: ev.offsetX, y: ev.offsetY } as any);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const cross = (p.x - a.x) * dy - (p.y - a.y) * dx;
      const signedDist = cross / len;
      lastSignedDist = signedDist;
      const roundness = Math.max(0.08, Math.min(0.9, Math.abs(signedDist) / 180));
      const type: EdgeCurveOverride["type"] = signedDist >= 0 ? "curvedCW" : "curvedCCW";
      pendingEdgeOverride = { type, roundness };
      updateEdgeSmooth(draggingEdgeId, { enabled: true, type, roundness });
      applyEdgeInfluence(draggingEdgeId, signedDist);
    };

    const onMouseUp = () => {
      if (draggingEdgeId && pendingEdgeOverride) {
        const edgeId = draggingEdgeId;
        const nextOverride = pendingEdgeOverride;
        startEdgeWobble(edgeId, nextOverride);
        edgeCurveOverridesRef.current[edgeId] = nextOverride;
        if (Math.abs(lastSignedDist) > 1e-3) {
          influencedEdges.forEach((id) => {
            const base = influencedBaseSmooth.get(id);
            if (!base) return;
            const t = lastSignedDist >= 0 ? "curvedCW" : "curvedCCW";
            const r = Math.max(0.07, Math.min(0.85, base.roundness + Math.min(0.16, Math.abs(lastSignedDist) / 320)));
            edgeCurveOverridesRef.current[id] = { type: t, roundness: r };
            updateEdgeSmooth(id, { enabled: true, type: t, roundness: r });
            startEdgeWobble(id, { type: t, roundness: r });
          });
        }
      }
      resetEdgeInfluence();
      draggingEdgeId = null;
      pendingEdgeOverride = null;
      container.style.cursor = "";
    };

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    network.on("click", (params: any) => {
      if (lastEdgeAtDown && params?.edges?.[0] === lastEdgeAtDown) {
        lastEdgeAtDown = null;
      }
      if (params?.edges?.length) {
        const srcEvent = params?.event?.srcEvent as MouseEvent | undefined;
        const withModifier = !!(srcEvent?.ctrlKey || srcEvent?.metaKey);
        if (!withModifier) return;
        const id = params.edges[0];
        const edge = edgesDSRef.current.get(id as any);
        handleEdgeClick(edge);
      }
    });

    network.on("dragEnd", (params: any) => {
      const ids: string[] = ((params?.nodes ?? []) as Array<string | number>).map(String);
      if (ids.length) setNodesFixed(true, ids);
      registerCurrentPositions(ids.length ? ids : undefined);
    });
    network.on("dragStart", (params: any) => {
      const ids: string[] = ((params?.nodes ?? []) as Array<string | number>).map(String);
      if (ids.length) setNodesFixed(false, ids);
    });
    network.on("hoverNode", (params: any) => {
      const id = String(params?.node ?? "");
      if (!id) return;
      highlightHoverPath(id);
    });
    network.on("blurNode", () => {
      clearHoverPath();
    });

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      resetEdgeInfluence();
      clearHoverPath();
      Object.keys(edgeWobbleRafRef.current).forEach((id) => stopEdgeWobble(id));
      network.destroy();
      networkRef.current = null;
      didFitRef.current = false;
      lastNodeCountRef.current = 0;
    };
  }, [handleEdgeClick]);

  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;
    const syncDataSet = <T extends { id: string }>(ds: DataSet<T>, next: T[]) => {
      const nextIds = new Set(next.map((x) => String(x.id)));
      const curIds = (ds.getIds() as Array<string | number>).map(String);
      const removeIds = curIds.filter((id) => !nextIds.has(id));
      if (removeIds.length > 0) ds.remove(removeIds as any);
      if (next.length > 0) ds.update(next as any);
    };
    const mergedNodes = nodes.map((node) => {
      const mem = layoutMemoryRef.current[node.id];
      const fixed = node.id.startsWith("__var:")
        ? (node.fixed ?? false)
        : { x: true, y: true };
      if (!mem) return { ...node, fixed };
      return { ...node, x: mem.x, y: mem.y, fixed };
    });

    const viewPosition = net.getViewPosition();
    const viewScale = net.getScale();
    syncDataSet(nodesDSRef.current as any, mergedNodes as any);
    syncDataSet(edgesDSRef.current as any, edgesWithOverrides as any);

    const prevCount = lastNodeCountRef.current;
    const curCount = nodes.length;
    lastNodeCountRef.current = curCount;

    if ((!didFitRef.current && curCount > 0) || curCount > prevCount) {
      const ids = (nodesDSRef.current.getIds() as Array<string | number>).map(String);
      for (const id of ids) {
        if (id.startsWith("__var:")) continue;
        nodesDSRef.current.update({ id, fixed: { x: true, y: true } } as any);
      }
      if (!didFitRef.current) {
        net.fit({ animation: false });
        net.moveTo({ scale: net.getScale() * 2, animation: false });
      }
      const positions = net.getPositions(ids);
      for (const id of ids) {
        const p = positions[id];
        if (!p) continue;
        layoutMemoryRef.current[id] = { x: p.x, y: p.y };
      }
      didFitRef.current = true;
      return;
    }

    // Visual-only updates should preserve camera.
    net.moveTo({ position: viewPosition, scale: viewScale, animation: false });
  }, [nodes, edgesWithOverrides]);

  const renderSubPaneBody = (subPaneId: SubPaneId) => {
    if (subPaneId === "null-controls") {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setHighlightNulls((v) => !v)}
            style={{
              flex: 1,
              textAlign: "left",
              background: highlightNulls
                ? "rgba(255, 110, 110, 0.22)"
                : "rgba(255,255,255,0.06)",
              border: highlightNulls
                ? "1px solid rgba(255, 130, 130, 0.85)"
                : "1px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              color: highlightNulls
                ? "rgba(255, 185, 185, 0.98)"
                : "rgba(245,252,255,0.92)",
              cursor: "pointer",
              padding: "4px 8px",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 700,
            }}
            title={highlightNulls ? "Disable null highlight" : "Highlight nulls"}
          >
            Null
          </button>
          <button
            type="button"
            onClick={() => setHighlightUndefined((v) => !v)}
            style={{
              flex: 1,
              textAlign: "left",
              background: highlightUndefined
                ? "rgba(255, 210, 120, 0.28)"
                : "rgba(255,255,255,0.06)",
              border: highlightUndefined
                ? "1px solid rgba(255, 220, 150, 0.9)"
                : "1px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              color: highlightUndefined
                ? "rgba(255, 240, 210, 0.98)"
                : "rgba(245,252,255,0.92)",
              cursor: "pointer",
              padding: "4px 8px",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 700,
            }}
            title={highlightUndefined ? "Disable undefined highlight" : "Highlight undefined"}
          >
            Undefined
          </button>
          <button
            type="button"
            onClick={() => setHighlightNaNValue((v) => !v)}
            style={{
              flex: 1,
              textAlign: "left",
              background: highlightNaNValue
                ? "rgba(255, 130, 220, 0.26)"
                : "rgba(255,255,255,0.06)",
              border: highlightNaNValue
                ? "1px solid rgba(255, 170, 230, 0.9)"
                : "1px solid rgba(255,255,255,0.18)",
              borderRadius: 6,
              color: highlightNaNValue
                ? "rgba(255, 225, 248, 0.98)"
                : "rgba(245,252,255,0.92)",
              cursor: "pointer",
              padding: "4px 8px",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 700,
            }}
            title={highlightNaNValue ? "Disable NaN highlight" : "Highlight NaN"}
          >
            NaN
          </button>
          <button
            type="button"
            onClick={() => setShowNulls((v) => !v)}
            title={showNulls ? "Hide all null nodes" : "Show all null nodes"}
            style={{
              width: 24,
              height: 24,
              lineHeight: "20px",
              textAlign: "center",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.30)",
              background: showNulls
                ? "rgba(255,255,255,0.10)"
                : "rgba(255,255,255,0.05)",
              color: "rgba(235,240,247,0.9)",
              cursor: "pointer",
              fontSize: 10,
              padding: 0,
              flex: "0 0 auto",
            }}
          >
            {showNulls ? "ON" : "OFF"}
          </button>
        </div>
      );
    }

    if (subPaneId === "class-definitions") {
      return classSummaries.length === 0 ? (
        <div style={{ opacity: 0.72 }}>(none)</div>
      ) : (
        classSummaries.map((def) => (
          <div key={def.name} style={{ marginBottom: 8 }}>
            <div
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedClasses((prev) => ({ ...prev, [def.name]: !prev[def.name] }))
                }
                style={{
                  width: 24,
                  height: 24,
                  lineHeight: "20px",
                  textAlign: "center",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.28)",
                  borderRadius: 6,
                  color: "rgba(235,240,247,0.9)",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 700,
                  flex: "0 0 auto",
                }}
                title={expandedClasses[def.name] ? "Collapse field list" : "Expand field list"}
              >
                <span
                  style={{
                    display: "inline-block",
                    transform: expandedClasses[def.name] ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 120ms ease",
                  }}
                >
                  ⚙
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setHighlightedClasses((prev) => {
                    const next = { ...prev };
                    if (next[def.name]) delete next[def.name];
                    else next[def.name] = true;
                    return next;
                  })
                }
                style={{
                  flex: 1,
                  textAlign: "left",
                  background: highlightedClasses[def.name]
                    ? "rgba(90, 220, 120, 0.22)"
                    : "rgba(255,255,255,0.06)",
                  border: highlightedClasses[def.name]
                    ? "1px solid rgba(130, 255, 160, 0.75)"
                    : "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 6,
                  color: highlightedClasses[def.name]
                    ? "rgba(130, 255, 160, 0.98)"
                    : "rgba(245,252,255,0.92)",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 700,
                }}
                title={highlightedClasses[def.name] ? "Disable class highlight" : "Highlight class instances"}
              >
                {def.name}
              </button>
              <button
                type="button"
                onClick={() =>
                  setHiddenClasses((prev) => {
                    const next = { ...prev };
                    if (next[def.name]) delete next[def.name];
                    else next[def.name] = true;
                    return next;
                  })
                }
                title={hiddenClasses[def.name] ? "Show instances" : "Hide instances"}
                style={{
                  width: 40,
                  height: 24,
                  lineHeight: "20px",
                  textAlign: "center",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.30)",
                  background: hiddenClasses[def.name]
                    ? "rgba(255,255,255,0.10)"
                    : "rgba(255,255,255,0.05)",
                  color: "rgba(235,240,247,0.9)",
                  cursor: "pointer",
                  fontSize: 10,
                  padding: 0,
                  flex: "0 0 auto",
                }}
              >
                {hiddenClasses[def.name] ? "SHOW" : "HIDE"}
              </button>
            </div>

            {expandedClasses[def.name] &&
              (def.fields.length === 0 ? (
                <div style={{ opacity: 0.72, fontSize: 11, marginTop: 4, marginLeft: 6 }}>
                  └─ (no constructor fields)
                </div>
              ) : (
                <div style={{ display: "grid", gap: 3, marginLeft: 30, marginTop: 4 }}>
                  {def.fields.map((field, i) => {
                    const key = collapseKey(def.name, field);
                    const collapsed = !!collapsedFields[key];
                    const highlighted = !!highlightedFields[key];
                    return (
                      <div key={field} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setHighlightedFields((prev) => {
                              const next = { ...prev };
                              if (next[key]) delete next[key];
                              else next[key] = true;
                              return next;
                            })
                          }
                          style={{
                            flex: 1,
                            textAlign: "left",
                            background: highlighted ? "rgba(90, 220, 120, 0.22)" : "rgba(255,255,255,0.06)",
                            border: highlighted
                              ? "1px solid rgba(130, 255, 160, 0.75)"
                              : "1px solid rgba(255,255,255,0.18)",
                            borderRadius: 6,
                            color: highlighted ? "rgba(130, 255, 160, 0.98)" : "rgba(245, 252, 255, 0.92)",
                            cursor: "pointer",
                            padding: "3px 6px",
                            fontFamily: "inherit",
                            fontSize: 11,
                          }}
                          title={highlighted ? "Disable field highlight" : "Highlight this field"}
                        >
                          {(i === def.fields.length - 1 ? "└─ " : "├─ ") + field}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedFields((prev) => {
                              const next = { ...prev };
                              if (next[key]) delete next[key];
                              else next[key] = true;
                              return next;
                            })
                          }
                          style={{
                            width: 24,
                            height: 24,
                            lineHeight: "20px",
                            textAlign: "center",
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.30)",
                            background: collapsed
                              ? "rgba(255,255,255,0.10)"
                              : "rgba(255,255,255,0.05)",
                            color: "rgba(235,240,247,0.9)",
                            cursor: "pointer",
                            fontSize: 10,
                            padding: 0,
                            flex: "0 0 auto",
                          }}
                          title={collapsed ? "Uncollapse this field" : "Collapse this field"}
                        >
                          {collapsed ? "SHOW" : "HIDE"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        ))
      );
    }

    return availableVarNames.length === 0 ? (
      <div style={{ opacity: 0.72 }}>(none)</div>
    ) : (
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
        {availableVarNames.map((name) => (
          <li key={name}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                onClick={() =>
                  setSelectedVarName(selectedVarName === name ? null : name)
                }
                style={{
                  flex: 1,
                  textAlign: "left",
                  background:
                    selectedVarName === name
                      ? "rgba(90, 220, 120, 0.22)"
                      : "rgba(255, 255, 255, 0.06)",
                  border:
                    selectedVarName === name
                      ? "1px solid rgba(130, 255, 160, 0.75)"
                      : "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: 6,
                  padding: "5px 8px",
                  cursor: "pointer",
                  color:
                    selectedVarName === name
                      ? "rgba(130, 255, 160, 0.98)"
                      : "rgba(245, 252, 255, 0.92)",
                  fontWeight: selectedVarName === name ? 700 : 500,
                  opacity: hiddenRootVarArrows[name] ? 0.72 : 1,
                }}
                title={selectedVarName === name ? "Disable variable highlight" : "Highlight this variable"}
              >
                {name}
              </button>
              <button
                type="button"
                onClick={() =>
                  setHiddenRootVarArrows((prev) => {
                    const next = { ...prev };
                    if (next[name]) delete next[name];
                    else next[name] = true;
                    return next;
                  })
                }
                title={hiddenRootVarArrows[name] ? "Show root arrow" : "Hide root arrow"}
                style={{
                  width: 40,
                  height: 24,
                  lineHeight: "20px",
                  textAlign: "center",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.30)",
                  background: hiddenRootVarArrows[name]
                    ? "rgba(255,255,255,0.10)"
                    : "rgba(255,255,255,0.05)",
                  color: "rgba(235,240,247,0.9)",
                  cursor: "pointer",
                  fontSize: 10,
                  padding: 0,
                  flex: "0 0 auto",
                }}
              >
                {hiddenRootVarArrows[name] ? "SHOW" : "HIDE"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const startOverlayDrag = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button,input,select,textarea,a")) return;

    const area = graphAreaRef.current;
    const overlay = overlayRef.current;
    if (!area || !overlay) return;

    const areaRect = area.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    overlayDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: overlayRect.top - areaRect.top,
      startLeft: overlayRect.left - areaRect.left,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = overlayDragRef.current;
      if (!drag) return;

      const area = graphAreaRef.current;
      const overlay = overlayRef.current;
      if (!area || !overlay) return;

      const areaRect = area.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const maxLeft = Math.max(0, areaRect.width - overlayRect.width);
      const maxTop = Math.max(0, areaRect.height - overlayRect.height);
      const nextLeft = Math.max(0, Math.min(maxLeft, drag.startLeft + (e.clientX - drag.startX)));
      const nextTop = Math.max(0, Math.min(maxTop, drag.startTop + (e.clientY - drag.startY)));
      setOverlayPos({ top: nextTop, left: nextLeft });
    };
    const onMouseUp = () => {
      overlayDragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={prev} disabled={step === 0} title="Prev (j)">
          ◀
        </button>

        <label style={{ whiteSpace: "nowrap" }}>
          Step: <b>{step}</b> / {maxStep}
        </label>

        <button onClick={next} disabled={step === maxStep} title="Next (k)">
          ▶
        </button>

        <input
          type="range"
          min={0}
          max={maxStep}
          value={clamp(step)}
          onChange={(e) => setStep(Number(e.target.value))}
          style={{ flex: 1, marginLeft: 8 }}
        />
      </div>

      <div ref={graphAreaRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <button
          type="button"
          onClick={redrawLayout}
          onMouseEnter={() => setRedrawHovered(true)}
          onMouseLeave={() => setRedrawHovered(false)}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 5,
            padding: "4px 10px",
            borderRadius: 6,
            border: redrawHovered
              ? "1px solid rgba(130, 255, 160, 0.75)"
              : "1px solid rgba(255,255,255,0.28)",
            background: redrawHovered
              ? "rgba(58, 130, 78, 0.78)"
              : "rgba(24, 30, 37, 0.72)",
            color: redrawHovered
              ? "rgba(234, 255, 240, 0.98)"
              : "rgba(245, 252, 255, 0.92)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
          }}
          title="Recalculate layout"
        >
          Redraw
        </button>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        <div
          ref={overlayRef}
          onMouseDown={startOverlayDrag}
          style={{
            position: "absolute",
            ...(overlayPos
              ? { top: overlayPos.top, left: overlayPos.left, right: "auto" as const }
              : { top: 10, right: 10 }),
            minWidth: 170,
            maxWidth: 320,
            maxHeight: "60%",
            overflow: "auto",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(24, 30, 37, 0.55)",
            backdropFilter: "blur(2px)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.35,
            color: "rgba(245, 252, 255, 0.92)",
            cursor: "move",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              marginBottom: 6,
              padding: "2px 4px",
              borderRadius: 4,
              border: "1px dashed rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.02)",
              cursor: "grab",
              userSelect: "none",
              fontSize: 10,
              fontWeight: 600,
              opacity: 0.62,
            }}
            title="Drag this panel"
          >
            <span style={{ letterSpacing: 1.2 }}>⋮⋮</span>
          </div>
          {SUB_PANE_IDS.map((subPaneId) => (
            <div
              key={subPaneId}
              style={{
                marginBottom: 8,
                padding: "2px 0 6px",
                borderBottom:
                  subPaneId === SUB_PANE_IDS[SUB_PANE_IDS.length - 1]
                    ? "none"
                    : "1px solid rgba(255,255,255,0.12)",
              }}
            >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                    opacity: 0.9,
                    fontSize: 12,
                    fontWeight: 700,
                    userSelect: "none",
                  }}
                >
                  <span>{SUB_PANE_LABELS[subPaneId]}</span>
                </div>
                {renderSubPaneBody(subPaneId)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
