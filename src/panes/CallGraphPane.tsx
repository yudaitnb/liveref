import { useEffect, useMemo, useState } from "react";
import { useTraceStore } from "../state/traceStore";
import { useUIStore } from "../state/uiStore";

type CallGraphPaneProps = {
  onJumpToHeap?: () => void;
};

type CallTreeNode = {
  id: number;
  fnName: string;
  startStep: number;
  startCheckpoint: string | null;
  endStep: number;
  endCheckpoint: string | null;
  children: CallTreeNode[];
};

function checkpointToLine(checkpointId: string | undefined): string {
  if (!checkpointId) return "-";
  const m = /^L(\d+):(\d+)$/.exec(checkpointId);
  if (!m) return checkpointId;
  return `L${m[1]}:${m[2]}`;
}

function inRange(step: number, from: number, to: number) {
  return step >= from && step <= to;
}

export default function CallGraphPane({ onJumpToHeap }: CallGraphPaneProps) {
  const trace = useTraceStore((s) => s.trace);
  const selectedStep = useUIStore((s) => s.selectedStep);
  const setSelectedStep = useUIStore((s) => s.setSelectedStep);
  const setSelectedCheckpointId = useUIStore((s) => s.setSelectedCheckpointId);
  const [query, setQuery] = useState("");
  const [onlyActivePath, setOnlyActivePath] = useState(false);
  const [showStepChips, setShowStepChips] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const jumpTo = (step: number, checkpointId: string | null) => {
    setSelectedStep(step);
    setSelectedCheckpointId(checkpointId);
    onJumpToHeap?.();
  };

  const maxStep = Math.max(0, trace.steps.length - 1);

  const frames = useMemo(() => {
    const roots: CallTreeNode[] = [];
    const stack: CallTreeNode[] = [];
    let nextId = 1;

    for (const ev of trace.callEvents ?? []) {
      if (ev.kind === "enter") {
        const node: CallTreeNode = {
          id: nextId++,
          fnName: ev.fnName || "anonymous",
          startStep: Math.max(0, Math.min(maxStep, ev.stepId)),
          startCheckpoint: ev.checkpointId ?? null,
          endStep: maxStep,
          endCheckpoint: null,
          children: [],
        };
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(node);
        else roots.push(node);
        stack.push(node);
        continue;
      }

      const top = stack.pop();
      if (!top) continue;
      top.endStep = Math.max(0, Math.min(maxStep, ev.stepId));
      top.endCheckpoint = ev.checkpointId ?? null;
    }

    // close unbalanced frames at tail
    while (stack.length > 0) {
      const top = stack.pop()!;
      top.endStep = maxStep;
    }

    return roots;
  }, [trace.callEvents, maxStep]);

  const frameStepMap = useMemo(() => {
    const byFrame = new Map<number, number[]>();
    const allSteps = Array.from({ length: maxStep + 1 }, (_, i) => i);

    const fill = (node: CallTreeNode) => {
      const direct: number[] = [];
      for (const s of allSteps) {
        if (!inRange(s, node.startStep, node.endStep)) continue;
        const inChild = node.children.some((c) => inRange(s, c.startStep, c.endStep));
        if (!inChild) direct.push(s);
      }
      byFrame.set(node.id, direct);
      for (const c of node.children) fill(c);
    };

    for (const r of frames) fill(r);

    const topLevelDirect = allSteps.filter(
      (s) => !frames.some((f) => inRange(s, f.startStep, f.endStep))
    );

    return { byFrame, topLevelDirect };
  }, [frames, maxStep]);

  useEffect(() => {
    setCollapsed({});
  }, [trace.callEvents, trace.steps.length]);

  const activePathIds = useMemo(() => {
    const out: number[] = [];
    const walk = (n: CallTreeNode, acc: number[]): boolean => {
      if (!inRange(selectedStep, n.startStep, n.endStep)) return false;
      acc.push(n.id);
      for (const c of n.children) {
        const next = [...acc];
        if (walk(c, next)) {
          acc.splice(0, acc.length, ...next);
          return true;
        }
      }
      return true;
    };
    for (const r of frames) {
      const acc: number[] = [];
      if (walk(r, acc)) {
        out.push(...acc);
        break;
      }
    }
    return new Set(out);
  }, [frames, selectedStep]);

  const visibleFrames = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filterNode = (n: CallTreeNode): CallTreeNode | null => {
      const filteredChildren = n.children
        .map((c) => filterNode(c))
        .filter((c): c is CallTreeNode => !!c);
      const hitByName = q.length === 0 || n.fnName.toLowerCase().includes(q);
      const passSearch = hitByName || filteredChildren.length > 0;
      const passActive = !onlyActivePath || activePathIds.has(n.id);
      if (!passSearch || !passActive) return null;
      return { ...n, children: filteredChildren };
    };
    return frames
      .map((f) => filterNode(f))
      .filter((f): f is CallTreeNode => !!f);
  }, [frames, query, onlyActivePath, activePathIds]);

  const renderStepChip = (step: number) => {
    const cp = trace.steps[step]?.checkpointId ?? null;
    const active = step === selectedStep;
    return (
      <button
        key={`step-${step}`}
        type="button"
        className={`details-step-chip ${active ? "is-active" : ""}`}
        onClick={() => jumpTo(step, cp)}
        title={`Jump to step ${step}`}
      >
        #{step}
      </button>
    );
  };

  const renderFrame = (node: CallTreeNode) => {
    const frameActive = selectedStep >= node.startStep && selectedStep <= node.endStep;
    const frameCp = node.startCheckpoint ?? trace.steps[node.startStep]?.checkpointId ?? null;
    const directSteps = frameStepMap.byFrame.get(node.id) ?? [];
    const isCollapsed = collapsed[node.id] ?? true;
    const hoverInfo = `${node.fnName} #${node.startStep}-#${node.endStep} (${checkpointToLine(
      frameCp ?? undefined
    )})`;

    return (
      <div
        key={`frame-${node.id}`}
        className={`details-frame-card ${isCollapsed && node.children.length > 0 ? "is-collapsed" : ""}`}
      >
        <div className="details-frame-head-row">
          {node.children.length > 0 && (
            <button
              type="button"
              className="details-frame-disclosure"
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [node.id]: !(prev[node.id] ?? true) }))
              }
              title={isCollapsed ? "Expand children" : "Collapse children"}
              aria-label={isCollapsed ? "Expand children" : "Collapse children"}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          )}
          <button
            type="button"
            className={`details-frame-head ${frameActive ? "is-active" : ""}`}
            onClick={() => jumpTo(node.startStep, frameCp)}
            title={hoverInfo}
          >
            <span className="details-frame-title">{node.fnName}()</span>
          </button>
        </div>

        {showStepChips && directSteps.length > 0 && (
          <div className="details-step-row">{directSteps.map((s) => renderStepChip(s))}</div>
        )}

        {!isCollapsed && node.children.length > 0 && (
          <div className="details-children-row">{node.children.map((c) => renderFrame(c))}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ height: "100%", minHeight: 0, overflow: "auto", padding: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
        Call Frames: {frames.length} / Execution IDs: {trace.steps.length}
      </div>
      <div className="details-toolbar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by function name"
          className="details-filter-input"
        />
        <label className="details-toggle-item">
          <input
            type="checkbox"
            checked={onlyActivePath}
            onChange={(e) => setOnlyActivePath(e.target.checked)}
          />
          Current path only
        </label>
        <label className="details-toggle-item">
          <input
            type="checkbox"
            checked={showStepChips}
            onChange={(e) => setShowStepChips(e.target.checked)}
          />
          Show IDs
        </label>
      </div>

      <div className="details-frame-root">
        <div className="details-frame-card details-frame-card-root">
          <div className="details-frame-head is-root" title={`Global #0-#${maxStep}`}>
            <span className="details-frame-title">Global</span>
          </div>

          {showStepChips && frameStepMap.topLevelDirect.length > 0 && (
            <div className="details-step-row">
              {frameStepMap.topLevelDirect.map((s) => renderStepChip(s))}
            </div>
          )}

          {visibleFrames.length > 0 && (
            <div className="details-children-row">{visibleFrames.map((f) => renderFrame(f))}</div>
          )}
        </div>
      </div>
    </div>
  );
}
