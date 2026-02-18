import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataSet } from "vis-data";
import { Network } from "vis-network";
import "vis-network/styles/vis-network.css";

import { getStateAt } from "../trace/replay";
import { useUIStore } from "../state/uiStore";
import { useTraceStore } from "../state/traceStore";
import { useGraphStore } from "../state/graphStore";
import { useCodeStore } from "../state/codeStore";

type VisNode = {
  id: string;
  label: string;
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
};

type VisEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
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
  const setNodePos = useGraphStore((s) => s.setNodePos);
  const resetPos = useGraphStore((s) => s.resetPos);

  const step = useUIStore((s) => s.selectedStep);
  const setStep = useUIStore((s) => s.setSelectedStep);
  const setSelectedCheckpointId = useUIStore((s) => s.setSelectedCheckpointId);
  const selectedVarName = useUIStore((s) => s.selectedVarName);
  const setSelectedVarName = useUIStore((s) => s.setSelectedVarName);
  const [edgeCurveOverrides, setEdgeCurveOverrides] = useState<Record<string, EdgeCurveOverride>>({});
  const [collapsedFields, setCollapsedFields] = useState<Record<string, true>>({});
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
  const [hiddenClasses, setHiddenClasses] = useState<Record<string, true>>({});
  const [hiddenRootVarArrows, setHiddenRootVarArrows] = useState<Record<string, true>>({});
  const [showNulls, setShowNulls] = useState(true);
  const [highlightNulls, setHighlightNulls] = useState(false);
  const [highlightedClasses, setHighlightedClasses] = useState<Record<string, true>>({});
  const [highlightedFields, setHighlightedFields] = useState<Record<string, true>>({});

  // Flush GraphPane local UI state on sample switch.
  useEffect(() => {
    setEdgeCurveOverrides({});
    setCollapsedFields({});
    setExpandedClasses({});
    setHiddenClasses({});
    setHiddenRootVarArrows({});
    setShowNulls(true);
    setHighlightNulls(false);
    setHighlightedClasses({});
    setHighlightedFields({});
    resetPos();
  }, [sampleRevision, resetPos]);

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

      if (e.key === "ArrowLeft" || e.key === "j") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight" || e.key === "k") {
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

  // ===== ノード/エッジ生成（変数はエッジのみ。rootノードは透明アンカー）=====
  const { nodes, edges } = useMemo<{ nodes: VisNode[]; edges: VisEdge[] }>(() => {
    const nodes: VisNode[] = [];
    const edges: VisEdge[] = [];

    const primNodeId = (objId: string, key: string) => `p:${objId}:${key}`;
    const rootPrimId = (name: string) => `p:root:${name}`;

    // --- roots (透明アンカー + 変数名はエッジラベル) ---
    const rootNames = Object.keys(state.roots)
      .filter((n) => shouldShowRootVar(n))
      .sort();

    rootNames.forEach((name, i) => {
      const anchorId = `root:${name}`; // lastWrite のキーは別なので id は自由だが、位置保存のため安定させる
      const fallbackPos = { x: 60 + i * 120, y: 0 };
      const pos = nodePos[anchorId] ?? fallbackPos;

      // ★透明アンカー（ノードは見せない）
      nodes.push({
        id: anchorId,
        label: "",
        x: pos.x,
        y: pos.y,
        group: "rootAnchor",
        shape: "dot",
        size: 1,
        fixed: { x: true, y: true },
        physics: false,
        color: { background: "rgba(0,0,0,0)", border: "rgba(0,0,0,0)" },
        font: { size: 1, color: "rgba(0,0,0,0)" },
      });

      const v = state.roots[name];
      const hideRootArrow = !!hiddenRootVarArrows[name];

      if (v.kind === "obj") {
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
          color: isFocusedVar
            ? { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" }
            : { color: "#2e7d32", highlight: "#388e3c", hover: "#388e3c" },
          font: { size: 11, align: "middle" },
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
            color: isFocusedVar
              ? { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" }
              : { color: "#2e7d32", highlight: "#388e3c", hover: "#388e3c" },
            font: { size: 11, align: "middle" },
            data: { kind: "root", name },
          });
        }
      }
    });

    // --- objects + edges (reachable のみ表示) ---
    const objs = Object.values(state.objects).filter((o) => reachableObjIds.has(o.id) && !isHiddenObj(o.id));
    const directedRefCounts = new Map<string, number>();
    for (const oo of objs) {
      for (const vv of Object.values(oo.props)) {
        if (vv.kind !== "obj") continue;
        if (!reachableObjIds.has(vv.id)) continue;
        const dk = `${oo.id}->${vv.id}`;
        directedRefCounts.set(dk, (directedRefCounts.get(dk) ?? 0) + 1);
      }
    }
    const directedRefSeen = new Map<string, number>();

    const objBasePos = new Map<string, { x: number; y: number }>();
    objs.forEach((o, idx) => {
      const fallbackPos = { x: 80 + idx * 160, y: 140 };
      objBasePos.set(o.id, nodePos[o.id] ?? fallbackPos);
    });

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
      const pos = collapsedPlacementByNodeId.get(o.id) ?? nodePos[o.id] ?? fallbackPos;

      const props = Object.entries(o.props).sort(([a], [b]) => a.localeCompare(b));
      const objRefProps = props.filter(
        ([, vv]) => vv.kind === "obj" && reachableObjIds.has(vv.id)
      ) as Array<[string, { kind: "obj"; id: string }]>;
      const label =
        o.className ??
        (o.objKind === "array"
          ? "Array"
          : o.objKind === "function"
            ? "Function"
            : o.objKind === "class"
              ? "Class"
              : "Object");
      const collapseHighlighted = collapsedHighlightNodeIds.has(o.id);
      const classHighlighted = !!o.className && !!highlightedClasses[o.className];
      const fieldHighlighted = props.some(([k]) => isFieldHighlightedForObject(o.className, k));

      nodes.push({
        id: o.id,
        label,
        x: pos.x,
        y: pos.y,
        group: collapseHighlighted ? "objHighlight" : "obj",
        shape: "box",
        font: { size: 11 },
        borderWidth: collapseHighlighted || classHighlighted || fieldHighlighted ? 2 : 1,
        color: classHighlighted
          ? { background: "#7ed491", border: "#2f8f3f" }
          : {
              background: "#97c2fc",
              border: fieldHighlighted ? "#3aa95b" : collapseHighlighted ? "#7f95ad" : "#2b7ce9",
            },
        margin: { top: 4, right: 8, bottom: 4, left: 8 },
      });

      let primIndex = 0;
      let nullIndex = 0;
      const objRefCount = objRefProps.length;
      const objRefIndexByKey = new Map<string, number>();
      objRefProps.forEach(([key], i) => objRefIndexByKey.set(key, i));

      for (const [k, v] of props) {
        if (isFieldCollapsedForObject(o.className, k)) {
          continue; // collapsed: hide this field edge and place target node adjacent to parent
        }

        if (v.kind === "obj") {
          if (!reachableObjIds.has(v.id)) continue;
          const outIndex = objRefIndexByKey.get(k) ?? 0;
          const centered = objRefCount <= 1 ? 0 : outIndex / (objRefCount - 1) - 0.5;
          const dk = `${o.id}->${v.id}`;
          const rdk = `${v.id}->${o.id}`;
          const hasReverse = directedRefCounts.has(rdk);
          const seen = directedRefSeen.get(dk) ?? 0;
          directedRefSeen.set(dk, seen + 1);
          const dirTotal = directedRefCounts.get(dk) ?? 1;

          let curveType: string;
          let roundness: number;
          if (hasReverse) {
            // Force symmetric split for reciprocal edges: A->B and B->A always curve opposite.
            curveType = o.id < v.id ? "curvedCW" : "curvedCCW";
            const dirCentered = dirTotal <= 1 ? 0 : seen / (dirTotal - 1) - 0.5;
            roundness = 0.26 + Math.abs(dirCentered) * 0.14;
          } else {
            // Use dynamic smooth for non-reciprocal edges.
            // vis-network moves dynamic control points with physics, which works as pseudo edge repulsion.
            curveType = "dynamic";
            roundness = 0.2 + Math.abs(centered) * 0.12;
          }

          edges.push({
            id: `${o.id}-${k}-${v.id}`,
            from: o.id,
            to: v.id,
            label: k,
            arrows: "to",
            smooth: { enabled: true, type: curveType, roundness },
            width: isFieldHighlightedForObject(o.className, k) ? 4 : 1,
            color: isFieldHighlightedForObject(o.className, k)
              ? { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" }
              : undefined,
            font: { size: 10, align: "middle" },
            data: { kind: "prop", key: k },
          });
        } else {
          if (v.v === null) {
            if (!showNulls) continue;
            const nid = `n:${o.id}:${k}`;
            const nFallback = {
              x: pos.x + 120 + (nullIndex % 2) * 90,
              y: pos.y - 30 - Math.floor(nullIndex / 2) * 36,
            };
            nullIndex++;
            const npos = nodePos[nid] ?? nFallback;
            const nPosCollapsed = collapsedPlacementByNodeId.get(nid);

            nodes.push({
              id: nid,
              label: "null",
              x: (nPosCollapsed ?? npos).x,
              y: (nPosCollapsed ?? npos).y,
              group: "null",
              shape: "box",
              font: { size: 10, color: "#d8dde4" },
              color: highlightNulls
                ? { background: "#a32626", border: "#ff8a8a" }
                : { background: "#5f6875", border: "#b7c0cc" },
              margin: { top: 2, right: 6, bottom: 2, left: 6 },
            });

            edges.push({
              id: `${o.id}-${k}-${nid}`,
              from: o.id,
              to: nid,
              label: k,
              arrows: "to",
              dashes: true,
              smooth: { enabled: true, type: "dynamic", roundness: 0.28 },
              width: isFieldHighlightedForObject(o.className, k) ? 4 : 2,
              color: isFieldHighlightedForObject(o.className, k)
                ? { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" }
                : { color: "#a0a9b6", highlight: "#c2cad6", hover: "#c2cad6" },
              font: { size: 10, align: "middle" },
              data: { kind: "prop", key: k, isNull: true },
            });
            continue;
          }
          const pid = primNodeId(o.id, k);
          const pFallback = {
            x: pos.x + 120 + (primIndex % 3) * 80,
            y: pos.y + 40 + Math.floor(primIndex / 3) * 40,
          };
          primIndex++;
          const ppos = nodePos[pid] ?? pFallback;
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
            color: { background: "#ffffff", border: "#cfd6de" },
            margin: { top: 2, right: 6, bottom: 2, left: 6 },
          });

          edges.push({
            id: `${o.id}-${k}-${pid}`,
            from: o.id,
            to: pid,
            label: k,
            arrows: "to",
            width: isFieldHighlightedForObject(o.className, k) ? 4 : 1,
            color: isFieldHighlightedForObject(o.className, k)
              ? { color: "#5dff7a", highlight: "#74ff8d", hover: "#74ff8d" }
              : undefined,
            font: { size: 10, align: "middle" },
            data: { kind: "prop", key: k },
          });
        }
      }
    });

    return { nodes, edges };
  }, [state, nodePos, reachableObjIds, shouldShowRootVar, selectedVarName, isFieldCollapsedForObject, isHiddenObj, hiddenRootVarArrows, showNulls, highlightedClasses, highlightNulls, isFieldHighlightedForObject]);

  const edgesWithOverrides = useMemo(() => {
    return edges.map((e) => {
      const ov = edgeCurveOverrides[e.id];
      if (!ov) return e;
      return {
        ...e,
        smooth: { enabled: true, type: ov.type, roundness: ov.roundness },
      };
    });
  }, [edges, edgeCurveOverrides]);

  // ===== vis-network 本体 =====
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDSRef = useRef(new DataSet<VisNode>([]));
  const edgesDSRef = useRef(new DataSet<VisEdge>([]));

  const didFitRef = useRef(false);
  const lastNodeCountRef = useRef(0);

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
      const lk = `${edge.from}:${key}`;
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
      physics: {
        enabled: false,
        solver: "barnesHut",
        barnesHut: {
          gravitationalConstant: -1200,
          centralGravity: 0,
          springLength: 105,
          springConstant: 0.035,
          damping: 0.45,
          avoidOverlap: 0.05,
        },
      },
      interaction: {
        hover: true,
        navigationButtons: true,
        keyboard: { enabled: true },
      },
      nodes: {
        shape: "box",
        font: { size: 11 },
        margin: { top: 4, right: 8, bottom: 4, left: 8 },
      },
      edges: {
        color: { inherit: false },
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        font: { size: 10, align: "middle" },
        smooth: { enabled: true, type: "dynamic" },
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
          color: { background: "#5f6875", border: "#b7c0cc" },
          font: { size: 10, color: "#d8dde4" },
          margin: { top: 2, right: 6, bottom: 2, left: 6 },
        },
      },
    };

    const network = new Network(containerRef.current, data as any, options);
    networkRef.current = network;

    const container = containerRef.current;
    let draggingEdgeId: string | null = null;
    let lastEdgeAtDown: string | null = null;

    const onMouseDown = (ev: MouseEvent) => {
      const edgeId = network.getEdgeAt({ x: ev.offsetX, y: ev.offsetY } as any);
      if (!edgeId) return;
      draggingEdgeId = String(edgeId);
      lastEdgeAtDown = draggingEdgeId;
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
      const roundness = Math.max(0.08, Math.min(0.9, Math.abs(signedDist) / 180));
      const type: EdgeCurveOverride["type"] = signedDist >= 0 ? "curvedCW" : "curvedCCW";

      setEdgeCurveOverrides((prev) => {
        const cur = prev[draggingEdgeId!];
        if (cur && cur.type === type && Math.abs(cur.roundness - roundness) < 0.01) return prev;
        return { ...prev, [draggingEdgeId!]: { type, roundness } };
      });
    };

    const onMouseUp = () => {
      draggingEdgeId = null;
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

    // dragEnd：rootAnchor は fixed なので動かない想定。obj/prim だけ保存される。
    network.on("dragEnd", (params: any) => {
      const ids: string[] = (params?.nodes ?? []) as string[];
      if (!ids.length) return;
      const positions = network.getPositions(ids);
      for (const id of ids) {
        const p = positions[id];
        if (p) setNodePos(id, { x: p.x, y: p.y });
      }
    });

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      network.destroy();
      networkRef.current = null;
      didFitRef.current = false;
      lastNodeCountRef.current = 0;
    };
  }, [handleEdgeClick, setNodePos]);

  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;
    nodesDSRef.current = new DataSet<VisNode>(nodes as any);
    edgesDSRef.current = new DataSet<VisEdge>(edgesWithOverrides as any);
    net.setData({ nodes: nodesDSRef.current as any, edges: edgesDSRef.current as any });
    net.redraw();

    const prevCount = lastNodeCountRef.current;
    const curCount = nodes.length;
    lastNodeCountRef.current = curCount;

    if ((!didFitRef.current && curCount > 0) || curCount > prevCount) {
      // Re-layout only when graph shape changes, then freeze to avoid spring-like jitter while dragging.
      net.setOptions({ physics: { enabled: true } });
      net.stabilize(140);
      net.setOptions({ physics: { enabled: false } });
      net.fit({ animation: false });
      // Default view: show the fitted graph at 2x zoom.
      net.moveTo({ scale: net.getScale() * 2, animation: false });
      didFitRef.current = true;
    }
  }, [nodes, edgesWithOverrides]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={prev} disabled={step === 0} title="Prev (← / j)">
          ◀
        </button>

        <label style={{ whiteSpace: "nowrap" }}>
          Step: <b>{step}</b> / {maxStep}
        </label>

        <button onClick={next} disabled={step === maxStep} title="Next (→ / k)">
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

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            minWidth: 210,
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
          }}
        >
          <div
            style={{
              marginBottom: 8,
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
                  ? "rgba(90, 220, 120, 0.22)"
                  : "rgba(255,255,255,0.06)",
                border: highlightNulls
                  ? "1px solid rgba(130, 255, 160, 0.75)"
                  : "1px solid rgba(255,255,255,0.18)",
                borderRadius: 6,
                color: highlightNulls
                  ? "rgba(130, 255, 160, 0.98)"
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
                fontSize: 14,
                padding: 0,
                flex: "0 0 auto",
              }}
            >
              {showNulls ? "×" : "+"}
            </button>
          </div>

          <div style={{ marginBottom: 6, opacity: 0.86, fontSize: 13, fontWeight: 700 }}>
            Class Definitions
          </div>
          {classSummaries.length === 0 ? (
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
                      width: 24,
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
                      fontSize: 14,
                      padding: 0,
                      flex: "0 0 auto",
                    }}
                  >
                    {hiddenClasses[def.name] ? "+" : "×"}
                  </button>
                </div>

                {expandedClasses[def.name] && (
                  def.fields.length === 0 ? (
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
                                fontSize: 14,
                                padding: 0,
                                flex: "0 0 auto",
                              }}
                              title={collapsed ? "Uncollapse this field" : "Collapse this field"}
                            >
                              {collapsed ? "+" : "×"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            ))
          )}

          <div style={{ marginTop: 8, marginBottom: 4, opacity: 0.86, fontSize: 13, fontWeight: 700 }}>
            Available Variables
          </div>
          {availableVarNames.length === 0 ? (
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
                        width: 24,
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
                        fontSize: 14,
                        padding: 0,
                        flex: "0 0 auto",
                      }}
                    >
                      {hiddenRootVarArrows[name] ? "+" : "×"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
