import { useCodeStore } from "../state/codeStore";
import { samplePrograms } from "../samples/catalog";

export default function SamplesPane() {
  const currentCode = useCodeStore((s) => s.code);
  const setSampleCode = useCodeStore((s) => s.setSampleCode);

  return (
    <div className="samples-pane">
      <div className="samples-section-title">Simple</div>
      <div className="samples-grid">
        {samplePrograms
          .filter((s) => s.level === "simple")
          .map((sample) => {
            const isActive = currentCode === sample.code;
            return (
              <button
                key={sample.id}
                type="button"
                className={`sample-card ${isActive ? "is-active" : ""}`}
                onClick={() => setSampleCode(sample.code)}
              >
                <span className="sample-name">{sample.name}</span>
                <span className="sample-desc">{sample.description}</span>
              </button>
            );
          })}
      </div>

      <div className="samples-section-title">Complex</div>
      <div className="samples-grid">
        {samplePrograms
          .filter((s) => s.level === "complex")
          .map((sample) => {
            const isActive = currentCode === sample.code;
            return (
              <button
                key={sample.id}
                type="button"
                className={`sample-card ${isActive ? "is-active" : ""}`}
                onClick={() => setSampleCode(sample.code)}
              >
                <span className="sample-name">{sample.name}</span>
                <span className="sample-desc">{sample.description}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
