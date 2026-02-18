import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "../state/uiStore";
import { useTraceStore } from "../state/traceStore";
import { createRunner } from "../runner/runnerClient";
import { instrument } from "../runner/instrument";
import { useRunStore } from "../state/runStore";
import { useCodeStore } from "../state/codeStore";

type DecoIds = string[];
type WordWrap = "off" | "on";
type LineNumbers = "on" | "off";
type MonacoTheme = "vs-dark" | "vs";
type EditorPrefs = {
  fontSize: number;
  minimap: boolean;
  wordWrap: WordWrap;
  tabSize: number;
  lineNumbers: LineNumbers;
  theme: MonacoTheme;
};

const PREFS_KEY = "liveref.editor.prefs";
const defaultPrefs: EditorPrefs = {
  fontSize: 14,
  minimap: false,
  wordWrap: "off",
  tabSize: 2,
  lineNumbers: "on",
  theme: "vs-dark",
};

export default function EditorPane() {
  const trace = useTraceStore((s) => s.trace);
  const resetTrace = useTraceStore((s) => s.resetTrace);

  const code = useCodeStore((s) => s.code);
  const sampleRevision = useCodeStore((s) => s.sampleRevision);
  const setCode = useCodeStore((s) => s.setCode);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsHovered, setSettingsHovered] = useState(false);
  const [prefs, setPrefs] = useState<EditorPrefs>(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return defaultPrefs;
      const parsed = JSON.parse(raw) as Partial<EditorPrefs>;
      return { ...defaultPrefs, ...parsed };
    } catch {
      return defaultPrefs;
    }
  });
  type CheckpointRange = { checkpointId: string; startLine: number; startCol: number; endLine: number; endCol: number };
  type CheckpointMarker = CheckpointRange & { markerCol: number; totalAtId: number };
  function parseCheckpointId(checkpointId: string): { line: number; col: number } | null {
    const m = /^L(\d+):(\d+)$/.exec(checkpointId);
    if (!m) return null;
    return { line: Number(m[1]), col: Number(m[2]) };
  }

  const selectedCheckpointId = useUIStore((s) => s.selectedCheckpointId);
  const selectedVarName = useUIStore((s) => s.selectedVarName);
  const setSelectedCheckpointId = useUIStore((s) => s.setSelectedCheckpointId);
  const setSelectedStep = useUIStore((s) => s.setSelectedStep);
  const resetUI = useUIStore((s) => s.resetUI);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const markerDecosRef = useRef<DecoIds>([]);
  const highlightDecosRef = useRef<DecoIds>([]);
  const selectedVarDecosRef = useRef<DecoIds>([]);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);
  const sortedRangesRef = useRef<CheckpointRange[]>([]);
  const inferStepForCheckpointRef = useRef<(checkpointId: string) => number | null>(() => null);

  // checkpointId -> candidate steps (execution order)
  const checkpointToSteps = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of trace.steps) {
      if (!s.checkpointId) continue;
      const arr = m.get(s.checkpointId) ?? [];
      arr.push(s.stepId);
      m.set(s.checkpointId, arr);
    }
    return m;
  }, [trace]);

  // Temporary inference strategy:
  // if loop iteration / function-call context is needed, pick the 1st execution.
  const inferStepForCheckpoint = useCallback(
    (checkpointId: string): number | null => {
      const steps = checkpointToSteps.get(checkpointId);
      if (!steps || steps.length === 0) return null;
      return steps[0] ?? null;
    },
    [checkpointToSteps]
  );

  // ダミー checkpointId ranges を line index でソートして、カーソルから “最近傍の上側” を引けるように
  const { sortedRanges, markerRanges } = useMemo<{
    sortedRanges: CheckpointRange[];
    markerRanges: CheckpointMarker[];
  }>(() => {
    const rawIds: string[] = [];
    const uniqueIds = new Set<string>();
    const sortedRanges: CheckpointRange[] = [];
    const markerRanges: CheckpointMarker[] = [];

    // Prefer static (all injected checkpoints), not only executed ones.
    try {
      const compiled = instrument(code);
      const re = /__checkpoint\(\s*["'`](L\d+:\d+)["'`]\s*\)/g;
      let m: RegExpExecArray | null = null;
      while ((m = re.exec(compiled))) {
        rawIds.push(m[1]);
        uniqueIds.add(m[1]);
      }
    } catch {
      // Fallback to executed checkpoints from trace.
    }

    if (rawIds.length === 0) {
      for (const s of trace.steps) {
        if (s.checkpointId) {
          rawIds.push(s.checkpointId);
          uniqueIds.add(s.checkpointId);
        }
      }
    }

    for (const id of uniqueIds) {
      const p = parseCheckpointId(id);
      if (!p) continue;
      sortedRanges.push({
        checkpointId: id,
        startLine: p.line,
        startCol: p.col,
        endLine: p.line,
        endCol: p.col,
      });
    }

    const totalsById = new Map<string, number>();
    for (const id of rawIds) {
      totalsById.set(id, (totalsById.get(id) ?? 0) + 1);
    }
    const seenById = new Map<string, number>();
    for (const id of rawIds) {
      const p = parseCheckpointId(id);
      if (!p) continue;
      const seen = seenById.get(id) ?? 0;
      seenById.set(id, seen + 1);
      const totalAtId = totalsById.get(id) ?? 1;
      const spread = Math.min(totalAtId - 1, 4);
      const offset = spread === 0 ? 0 : seen % (spread + 1);

      markerRanges.push({
        checkpointId: id,
        startLine: p.line,
        startCol: p.col,
        endLine: p.line,
        endCol: p.col,
        markerCol: p.col + offset,
        totalAtId,
      });
    }

    sortedRanges.sort((a, b) => (a.startLine !== b.startLine ? a.startLine - b.startLine : a.startCol - b.startCol));
    markerRanges.sort((a, b) => (a.startLine !== b.startLine ? a.startLine - b.startLine : a.markerCol - b.markerCol));
    return { sortedRanges, markerRanges };
  }, [code, trace.steps]);

  useEffect(() => {
    sortedRangesRef.current = sortedRanges;
  }, [sortedRanges]);

  useEffect(() => {
    inferStepForCheckpointRef.current = inferStepForCheckpoint;
  }, [inferStepForCheckpoint]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage errors in restricted environments.
    }
  }, [prefs]);

  const options = useMemo(() => ({
    fontSize: prefs.fontSize,
    minimap: { enabled: prefs.minimap },
    wordWrap: prefs.wordWrap,
    tabSize: prefs.tabSize,
    lineNumbers: prefs.lineNumbers,
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 8,
    automaticLayout: true,
  }), [prefs]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    const model = editor.getModel();
    if (model) {
      const lastLine = model.getLineCount();
      const lastCol = model.getLineMaxColumn(lastLine);
      editor.setPosition({ lineNumber: lastLine, column: lastCol });
      editor.revealPositionInCenter({ lineNumber: lastLine, column: lastCol });
      editor.focus();
    }

    // 既存 listener を剥がす
    cursorListenerRef.current?.dispose?.();

    // カーソル移動→対応checkpointId推定→step更新
    cursorListenerRef.current = editor.onDidChangeCursorPosition((e: any) => {
      const line = e.position.lineNumber as number;
      const col = e.position.column as number;

      // “カーソル位置より前”で最大の checkpoint range を探す（MVP）
      let picked: CheckpointRange | null = null;
      for (const r of sortedRangesRef.current) {
        if (r.startLine < line || (r.startLine === line && r.startCol <= col)) picked = r;
        else break;
      }
      if (!picked) return;

      setSelectedCheckpointId(picked.checkpointId);

      const step = inferStepForCheckpointRef.current(picked.checkpointId);
      if (typeof step === "number") setSelectedStep(step);
    });
  };

  const runnerRef = useRef<ReturnType<typeof createRunner> | null>(null);
  if (!runnerRef.current) runnerRef.current = createRunner();

  const running = useRunStore((s) => s.running);
  const setRunning = useRunStore((s) => s.setRunning);
  const setResult = useRunStore((s) => s.setResult);
  const setError = useRunStore((s) => s.setError);
  const setTrace = useTraceStore((s) => s.setTrace);
  const clear = useRunStore((s) => s.clear);

  const runInFlightRef = useRef(false);
  const rerunRequestedRef = useRef(false);
  const latestCodeRef = useRef(code);

  useEffect(() => {
    latestCodeRef.current = code;
  }, [code]);

  const executeRun = useCallback(async (codeToRun: string) => {
    clear();
    setError(null);
    setRunning(true);
    try {
      const res = await runnerRef.current!.run(codeToRun, 1000, { snapshotEveryNSteps: 50 });
      setResult(res);
      setTrace(res.trace);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  }, [clear, setError, setResult, setRunning, setTrace]);

  const requestRun = useCallback(async () => {
    rerunRequestedRef.current = true;
    if (runInFlightRef.current) return;

    runInFlightRef.current = true;
    try {
      while (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        const codeToRun = latestCodeRef.current;
        await executeRun(codeToRun);
      }
    } finally {
      runInFlightRef.current = false;
    }
  }, [executeRun]);

  const stopNow = () => {
    rerunRequestedRef.current = false;
    runnerRef.current?.stop();
    setRunning(false);
    setError("Stopped.");
  };

  // Hard reset all runtime/UI state on sample switch.
  useEffect(() => {
    rerunRequestedRef.current = false;
    runnerRef.current?.stop();
    setRunning(false);
    clear();
    setError(null);
    resetTrace();
    resetUI();
  }, [sampleRevision, clear, resetTrace, resetUI, setError, setRunning]);

  // Initial load + code edit => same behavior as pressing "Run" (debounced)
  useEffect(() => {
    const id = window.setTimeout(() => {
      void requestRun();
    }, 300);
    return () => window.clearTimeout(id);
  }, [code, requestRun]);


  // ★装飾：計測ポイント（縦線/マーカー）を常時表示
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const next = markerRanges.map((r) => {
      const lineMaxCol = model.getLineMaxColumn(r.startLine);
      const safeCol = Math.max(1, Math.min(r.markerCol, lineMaxCol));
      const range = new monaco.Range(r.startLine, safeCol, r.startLine, safeCol);
      const stepIds = checkpointToSteps.get(r.checkpointId) ?? [];
      const preview = stepIds.slice(0, 8).join(", ");
      const more = stepIds.length > 8 ? `, ... (+${stepIds.length - 8})` : "";
      const orderText =
        stepIds.length > 0
          ? `executionOrderIds: [${preview}${more}]`
          : "executionOrderIds: [] (not executed yet)";
      return {
        range,
        options: {
          // 行頭の glyph + 本文中の列位置マーカー
          glyphMarginClassName: "checkpoint-glyph",
          glyphMarginHoverMessage: [{ value: `checkpointId: ${r.checkpointId}\n${orderText}` }],
          lineNumberHoverMessage: [{ value: `${orderText}` }],
          beforeContentClassName: "checkpoint-column-marker",
          afterContentClassName: "checkpoint-inline-dot",
        },
      };
    });

    markerDecosRef.current = editor.deltaDecorations(markerDecosRef.current, next);
  }, [markerRanges, checkpointToSteps, code]);

  // ★装飾：selectedCheckpointId のハイライト（列位置ベース）
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    highlightDecosRef.current = editor.deltaDecorations(highlightDecosRef.current, []);

    if (!selectedCheckpointId) return;

    const r = sortedRanges.find((x) => x.checkpointId === selectedCheckpointId);
    if (!r) return;

    const lineMaxCol = model.getLineMaxColumn(r.startLine);
    const safeCol = Math.max(1, Math.min(r.startCol, lineMaxCol));
    const anchorEndCol = Math.min(safeCol + 1, lineMaxCol);
    const range = new monaco.Range(r.startLine, safeCol, r.startLine, anchorEndCol);
    highlightDecosRef.current = editor.deltaDecorations(highlightDecosRef.current, [
      {
        range,
        options: {
          beforeContentClassName: "checkpoint-highlight-column",
          className: "checkpoint-highlight-anchor",
        },
      },
    ]);

    editor.revealPositionInCenter({ lineNumber: r.startLine, column: safeCol });
  }, [selectedCheckpointId, sortedRanges]);

  // Highlight selected variable name occurrences from GraphPane variable list selection.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    selectedVarDecosRef.current = editor.deltaDecorations(selectedVarDecosRef.current, []);
    if (!selectedVarName) return;

    const escaped = selectedVarName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = model.findMatches(`\\b${escaped}\\b`, true, true, true, null, false);
    const next = matches.map((m: any) => ({
      range: m.range,
      options: { inlineClassName: "var-highlight-inline" },
    }));

    selectedVarDecosRef.current = editor.deltaDecorations(selectedVarDecosRef.current, next);
  }, [selectedVarName, code]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => void requestRun()} disabled={running} title="Run (Worker)">
          Run
        </button>
        <button onClick={stopNow} disabled={!running} title="Stop (terminate worker)">
          Stop
        </button>
        <span style={{ opacity: 0.7 }}>
          timeout: 1000ms
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme={prefs.theme}
          value={code}
          onChange={(v) => setCode(v ?? "")}
          options={{ ...options, glyphMargin: true }}
          onMount={onMount}
        />

        {showSettings && (
          <div
            style={{
              position: "absolute",
              right: 12,
              bottom: 54,
              zIndex: 20,
              width: 260,
              padding: 10,
              borderRadius: 8,
              background: "rgba(30, 30, 30, 0.95)",
              border: "1px solid rgba(255,255,255,0.18)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
              display: "grid",
              gap: 10,
              fontSize: 12,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span>Font size: {prefs.fontSize}</span>
              <input
                type="range"
                min={10}
                max={28}
                step={1}
                value={prefs.fontSize}
                onChange={(e) => setPrefs((p) => ({ ...p, fontSize: Number(e.target.value) }))}
              />
            </label>

            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Minimap</span>
              <input
                type="checkbox"
                checked={prefs.minimap}
                onChange={(e) => setPrefs((p) => ({ ...p, minimap: e.target.checked }))}
              />
            </label>

            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>Theme</span>
              <select
                value={prefs.theme}
                onChange={(e) => setPrefs((p) => ({ ...p, theme: e.target.value as MonacoTheme }))}
              >
                <option value="vs-dark">Dark</option>
                <option value="vs">Light</option>
              </select>
            </label>

            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>Word wrap</span>
              <select
                value={prefs.wordWrap}
                onChange={(e) => setPrefs((p) => ({ ...p, wordWrap: e.target.value as WordWrap }))}
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </label>

            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>Tab size</span>
              <input
                type="number"
                min={1}
                max={8}
                value={prefs.tabSize}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    tabSize: Math.max(1, Math.min(8, Number(e.target.value) || defaultPrefs.tabSize)),
                  }))
                }
                style={{ width: 70 }}
              />
            </label>

            <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>Line numbers</span>
              <select
                value={prefs.lineNumbers}
                onChange={(e) => setPrefs((p) => ({ ...p, lineNumbers: e.target.value as LineNumbers }))}
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          onMouseEnter={() => setSettingsHovered(true)}
          onMouseLeave={() => setSettingsHovered(false)}
          title="Editor settings"
          aria-label="Editor settings"
          style={{
            position: "absolute",
            right: 20,
            bottom: 12,
            zIndex: 21,
            borderRadius: 999,
            width: 42,
            height: 42,
            padding: 0,
            fontSize: 22,
            lineHeight: 1,
            color: settingsHovered ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.82)",
            background: settingsHovered ? "rgba(20,20,20,0.60)" : "rgba(20,20,20,0.35)",
            border: settingsHovered
              ? "1px solid rgba(255,255,255,0.45)"
              : "1px solid rgba(255,255,255,0.28)",
            backdropFilter: "blur(2px)",
            transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );

}
