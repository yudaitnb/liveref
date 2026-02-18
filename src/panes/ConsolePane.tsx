import { useRunStore } from "../state/runStore";

export default function ConsolePane() {
  const running = useRunStore((s) => s.running);
  const lastResult = useRunStore((s) => s.lastResult);
  const lastError = useRunStore((s) => s.lastError);

  return (
    <div style={{ padding: 12, height: "100%", overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <div style={{ marginBottom: 8 }}>
        <b>Status:</b> {running ? "running..." : "idle"}
      </div>

      {lastError && (
        <div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>
          <b style={{ color: "salmon" }}>Runner error:</b>
          {"\n"}
          {lastError}
        </div>
      )}

      {lastResult && (
        <>
          <div style={{ marginBottom: 8 }}>
            <b>Result:</b> {lastResult.ok ? "ok" : "error"}
          </div>

          {!lastResult.ok && (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {lastResult.error.name}: {lastResult.error.message}
              {"\n"}
              {lastResult.error.stack ?? ""}
            </pre>
          )}

          <hr />

          <div style={{ marginTop: 8, marginBottom: 6 }}><b>Console logs</b></div>
          {lastResult.logs.length === 0 ? (
            <div>(no logs)</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {lastResult.logs.map((l, i) => (
                <div key={i} style={{ whiteSpace: "pre-wrap" }}>
                  <span style={{ opacity: 0.7 }}>[{l.level}] </span>
                  {JSON.stringify(l.args)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
