import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "../state/uiStore";
import { useTraceStore } from "../state/traceStore";
import { createRunner } from "../runner/runnerClient";
import { useRunStore } from "../state/runStore";


const initial = `function f(x) {
  return { a: x, b: { c: x + 1 } };
}

const x = 1;
const y = 2;
const z = f(3);

console.log(y);
`;

type DecoIds = string[];

export default function EditorPane() {
  const trace = useTraceStore((s) => s.trace);

  const [code, setCode] = useState(initial);
  type LocRange = { locId: string; startLine: number; startCol: number; endLine: number; endCol: number };
  function parseLocId(locId: string): { line: number; col: number } | null {
    const m = /^L(\d+):(\d+)$/.exec(locId);
    if (!m) return null;
    return { line: Number(m[1]), col: Number(m[2]) };
  }

  const selectedLocId = useUIStore((s) => s.selectedLocId);
  const setSelectedLocId = useUIStore((s) => s.setSelectedLocId);
  const setSelectedStep = useUIStore((s) => s.setSelectedStep);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const markerDecosRef = useRef<DecoIds>([]);
  const highlightDecosRef = useRef<DecoIds>([]);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);

  // locId -> last step
  const locToLastStep = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of trace.steps) {
      if (s.locId) m.set(s.locId, s.stepId);
    }
    return m;
  }, [trace]);

  // ダミー locId ranges を line index でソートして、カーソルから “最近傍の上側” を引けるように
  const sortedRanges = useMemo<LocRange[]>(() => {
    const seen = new Set<string>();
    const out: LocRange[] = [];

    for (const s of trace.steps) {
      const id = s.locId;
      if (!id) continue;
      const p = parseLocId(id);
      if (!p) continue;
      if (seen.has(id)) continue;          // 同じlocIdは1個だけマーカー表示
      seen.add(id);

      out.push({
        locId: id,
        startLine: p.line,
        startCol: p.col,
        endLine: p.line,
        endCol: p.col,
      });
    }

    out.sort((a, b) => (a.startLine !== b.startLine ? a.startLine - b.startLine : a.startCol - b.startCol));
    return out;
  }, [trace]);

  const options = useMemo(
    () => ({
      fontSize: 14,
      minimap: { enabled: false },
      automaticLayout: true,
    }),
    []
  );

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 既存 listener を剥がす
    cursorListenerRef.current?.dispose?.();

    // カーソル移動→対応locId推定→step更新
    cursorListenerRef.current = editor.onDidChangeCursorPosition((e: any) => {
      const line = e.position.lineNumber as number;
      const col = e.position.column as number;

      // “カーソル位置より前”で最大の locRange を探す（MVP）
      let picked: (typeof sortedRanges)[number] | null = null;
      for (const r of sortedRanges) {
        if (r.startLine < line || (r.startLine === line && r.startCol <= col)) picked = r;
        else break;
      }
      if (!picked) return;

      setSelectedLocId(picked.locId);

      const step = locToLastStep.get(picked.locId);
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

  const runNow = async () => {
    clear();
    setError(null);
    setRunning(true);
    try {
        const res = await runnerRef.current!.run(code, 1000, { snapshotEveryNSteps: 50 });
        setResult(res);
        setTrace(res.trace);
    } catch (e: any) {
        setError(String(e?.message ?? e));
    } finally {
        setRunning(false);
    }
  };

  const stopNow = () => {
  runnerRef.current?.stop();
  setRunning(false);
  setError("Stopped.");
  };


  // ★装飾：計測ポイント（縦線/マーカー）を常時表示
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const next = sortedRanges.map((r) => {
      const range = new monaco.Range(r.startLine, r.startCol, r.endLine, r.endCol);
      return {
        range,
        options: {
          // 行頭に “●” を出す（軽量・わかりやすい）
          glyphMarginClassName: "trace-glyph",
          glyphMarginHoverMessage: [{ value: `trace ${r.locId}` }],
        },
      };
    });

    markerDecosRef.current = editor.deltaDecorations(markerDecosRef.current, next);
  }, [sortedRanges, code]);

  // ★装飾：selectedLocId のハイライト
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    highlightDecosRef.current = editor.deltaDecorations(highlightDecosRef.current, []);

    if (!selectedLocId) return;

    const r = sortedRanges.find((x) => x.locId === selectedLocId);
    if (!r) return;

    const range = new monaco.Range(r.startLine, 1, r.startLine, model.getLineMaxColumn(r.startLine));
    highlightDecosRef.current = editor.deltaDecorations(highlightDecosRef.current, [
      { range, options: { isWholeLine: true, className: "loc-highlight-line" } },
    ]);

    editor.revealLineInCenter(r.startLine);
  }, [selectedLocId, sortedRanges]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={runNow} disabled={running} title="Run (Worker)">
          Run
        </button>
        <button onClick={stopNow} disabled={!running} title="Stop (terminate worker)">
          Stop
        </button>
        <span style={{ opacity: 0.7 }}>
          timeout: 1000ms
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          defaultLanguage="javascript"
          value={code}
          onChange={(v) => setCode(v ?? "")}
          options={{ ...options, glyphMargin: true }}
          onMount={onMount}
        />
      </div>
    </div>
  );

}
