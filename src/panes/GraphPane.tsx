import { useCallback, useEffect, useMemo, useRef } from "react";
import { DataSet } from "vis-data";
import { Network } from "vis-network";
import "vis-network/styles/vis-network.css";

import { getStateAt } from "../trace/replay";
import { useUIStore } from "../state/uiStore";
import { useTraceStore } from "../state/traceStore";
import { useGraphStore } from "../state/graphStore";

type VisNode = {
  id: string;
  label: string;
  x?: number;
  y?: number;
  fixed?: boolean | { x: boolean; y: boolean };
  physics?: boolean;
  group?: "rootAnchor" | "obj" | "prim";
  font?: { size?: number; color?: string };
  margin?: number | { top: number; right: number; bottom: number; left: number };
  shape?: "box" | "ellipse" | "dot";
  size?: number;
  color?: { background?: string; border?: string };
};

type VisEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  arrows?: string;
  font?: { size?: number; align?: "top" | "middle" | "bottom" };
  data?: any;
};

function syncDataSet<T extends { id: string }>(ds: DataSet<T>, items: T[]) {
  const nextIds = new Set(items.map((x) => x.id));
  const curIds = new Set((ds.getIds() as unknown as string[]) ?? []);
  const toRemove: string[] = [];
  for (const id of curIds) if (!nextIds.has(id)) toRemove.push(id);
  if (toRemove.length) ds.remove(toRemove);
  ds.update(items);
}

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

export default function GraphPane() {
  const trace = useTraceStore((s) => s.trace);
  const maxStep = Math.max(0, trace.steps.length - 1);

  const nodePos = useGraphStore((s) => s.nodePos);
  const setNodePos = useGraphStore((s) => s.setNodePos);

  const step = useUIStore((s) => s.selectedStep);
  const setStep = useUIStore((s) => s.setSelectedStep);
  const setSelectedLocId = useUIStore((s) => s.setSelectedLocId);

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

  // step → locId 同期
  useEffect(() => {
    const loc = trace.steps[clamp(step)]?.locId ?? null;
    setSelectedLocId(loc);
  }, [trace, step, clamp, setSelectedLocId]);

  // ===== 表示対象の reachability を計算（internal roots は起点にしない）=====
  const reachableObjIds = useMemo(() => {
    const q: string[] = [];
    const seen = new Set<string>();

    for (const [name, v] of Object.entries(state.roots)) {
      if (isInternalVarName(name)) continue;
      if (v.kind === "obj") {
        q.push(v.id);
        seen.add(v.id);
      }
    }

    while (q.length) {
      const oid = q.pop()!;
      const o = state.objects[oid];
      if (!o) continue;
      for (const vv of Object.values(o.props)) {
        if (vv.kind === "obj" && !seen.has(vv.id)) {
          seen.add(vv.id);
          q.push(vv.id);
        }
      }
    }

    return seen;
  }, [state.roots, state.objects]);

  // ===== ノード/エッジ生成（変数はエッジのみ。rootノードは透明アンカー）=====
  const { nodes, edges } = useMemo<{ nodes: VisNode[]; edges: VisEdge[] }>(() => {
    const nodes: VisNode[] = [];
    const edges: VisEdge[] = [];

    const primNodeId = (objId: string, key: string) => `p:${objId}:${key}`;
    const rootPrimId = (name: string) => `p:root:${name}`;
    const iconOf = (k: string) =>
      k === "array" ? "[]" : k === "function" ? "ƒ" : k === "class" ? "C" : "{}";

    // --- roots (透明アンカー + 変数名はエッジラベル) ---
    const rootNames = Object.keys(state.roots)
      .filter((n) => !isInternalVarName(n))
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

      if (v.kind === "obj") {
        if (!reachableObjIds.has(v.id)) return; // 念のため
        edges.push({
          id: `${anchorId}->${v.id}`,
          from: anchorId,
          to: v.id,
          label: name, // ★変数名はエッジだけ
          arrows: "to",
          font: { size: 11, align: "middle" },
          data: { kind: "root", name },
        });
      } else {
        // root が prim の場合：literalノード + 変数名エッジ
        const pid = rootPrimId(name);
        const pFallback = { x: pos.x + 160, y: pos.y };
        const ppos = nodePos[pid] ?? pFallback;

        nodes.push({
          id: pid,
          label: litLabel(v.v),
          x: ppos.x,
          y: ppos.y,
          group: "prim",
          shape: "box",
          font: { size: 12 },
          margin: { top: 4, right: 8, bottom: 4, left: 8 },
        });

        edges.push({
          id: `${anchorId}-${name}-${pid}`,
          from: anchorId,
          to: pid,
          label: name,
          arrows: "to",
          font: { size: 11, align: "middle" },
          data: { kind: "root", name },
        });
      }
    });

    // --- objects + edges (reachable のみ表示) ---
    const objs = Object.values(state.objects).filter((o) => reachableObjIds.has(o.id));

    objs.forEach((o, idx) => {
      const fallbackPos = { x: 80 + idx * 160, y: 140 };
      const pos = nodePos[o.id] ?? fallbackPos;

      const short = o.id.startsWith("o") ? o.id.slice(1) : o.id;
      const label = `${iconOf(o.objKind)}${short}`;

      nodes.push({
        id: o.id,
        label,
        x: pos.x,
        y: pos.y,
        group: "obj",
        shape: "box",
        font: { size: 11 },
        margin: { top: 4, right: 8, bottom: 4, left: 8 },
      });

      const props = Object.entries(o.props).sort(([a], [b]) => a.localeCompare(b));
      let primIndex = 0;

      for (const [k, v] of props) {
        if (v.kind === "obj") {
          if (!reachableObjIds.has(v.id)) continue;
          edges.push({
            id: `${o.id}-${k}-${v.id}`,
            from: o.id,
            to: v.id,
            label: k,
            arrows: "to",
            font: { size: 10, align: "middle" },
            data: { kind: "prop", key: k },
          });
        } else {
          const pid = primNodeId(o.id, k);
          const pFallback = {
            x: pos.x + 120 + (primIndex % 3) * 80,
            y: pos.y + 40 + Math.floor(primIndex / 3) * 40,
          };
          primIndex++;
          const ppos = nodePos[pid] ?? pFallback;

          nodes.push({
            id: pid,
            label: litLabel(v.v),
            x: ppos.x,
            y: ppos.y,
            group: "prim",
            shape: "box",
            font: { size: 12 },
            margin: { top: 4, right: 8, bottom: 4, left: 8 },
          });

          edges.push({
            id: `${o.id}-${k}-${pid}`,
            from: o.id,
            to: pid,
            label: k,
            arrows: "to",
            font: { size: 10, align: "middle" },
            data: { kind: "prop", key: k },
          });
        }
      }
    });

    return { nodes, edges };
  }, [state, nodePos, reachableObjIds]);

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
        const lw = state.lastWrite[`root:${name}`];
        if (!lw) return;
        setSelectedLocId(lw.locId ?? null);
        setStep(lw.stepId);
        return;
      }

      const key = String(edge?.data?.key ?? edge?.label ?? "");
      const lk = `${edge.from}:${key}`;
      const lw = state.lastWrite[lk];
      if (!lw) return;
      setSelectedLocId(lw.locId ?? null);
      setStep(lw.stepId);
    },
    [state.lastWrite, setSelectedLocId, setStep]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    if (networkRef.current) return;

    const data = { nodes: nodesDSRef.current, edges: edgesDSRef.current };

    const options: any = {
      autoResize: true,
      physics: { enabled: false },
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
        prim: { shape: "box", font: { size: 12 } },
      },
    };

    const network = new Network(containerRef.current, data as any, options);
    networkRef.current = network;

    network.on("click", (params: any) => {
      if (params?.edges?.length) {
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
      network.destroy();
      networkRef.current = null;
      didFitRef.current = false;
      lastNodeCountRef.current = 0;
    };
  }, [handleEdgeClick, setNodePos]);

  useEffect(() => {
    syncDataSet(nodesDSRef.current, nodes);
    syncDataSet(edgesDSRef.current, edges);

    const net = networkRef.current;
    if (!net) return;

    const prevCount = lastNodeCountRef.current;
    const curCount = nodes.length;
    lastNodeCountRef.current = curCount;

    if ((!didFitRef.current && curCount > 0) || curCount > prevCount) {
      net.fit({ animation: false });
      didFitRef.current = true;
    }
  }, [nodes, edges]);

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

      <div style={{ flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
