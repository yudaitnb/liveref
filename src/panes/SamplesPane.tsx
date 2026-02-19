import { useMemo, useState } from "react";
import { useCodeStore } from "../state/codeStore";
import { samplePrograms } from "../samples/catalog";

type SamplesPaneProps = {
  onSampleSelected?: () => void;
};

export default function SamplesPane({ onSampleSelected }: SamplesPaneProps) {
  const currentCode = useCodeStore((s) => s.code);
  const setSampleCode = useCodeStore((s) => s.setSampleCode);
  const [selectedCategory, setSelectedCategory] = useState("All");

  const categories = useMemo(
    () => ["All", ...new Set(samplePrograms.map((sample) => sample.category))],
    []
  );

  const visibleSimpleSamples = samplePrograms.filter(
    (sample) =>
      sample.level === "simple" &&
      (selectedCategory === "All" || sample.category === selectedCategory)
  );
  const visibleComplexSamples = samplePrograms.filter(
    (sample) =>
      sample.level === "complex" &&
      (selectedCategory === "All" || sample.category === selectedCategory)
  );
  const handleSampleClick = (code: string) => {
    setSampleCode(code);
    onSampleSelected?.();
  };

  return (
    <div className="samples-pane">
      <div className="samples-filter-title">Category Filter</div>
      <div className="samples-filter-row">
        {categories.map((category) => {
          const isActive = category === selectedCategory;
          return (
            <button
              key={category}
              type="button"
              className={`sample-filter-chip ${isActive ? "is-active" : ""}`}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          );
        })}
      </div>

      <div className="samples-section-title">Simple</div>
      <div className="samples-grid">
        {visibleSimpleSamples.length === 0 && <div className="samples-empty">No samples in this category.</div>}
        {visibleSimpleSamples.map((sample) => {
            const isActive = currentCode === sample.code;
            return (
              <button
                key={sample.id}
                type="button"
                className={`sample-card ${isActive ? "is-active" : ""}`}
                onClick={() => handleSampleClick(sample.code)}
              >
                <span className="sample-category">{sample.category}</span>
                <span className="sample-name">{sample.name}</span>
                <span className="sample-desc">{sample.description}</span>
              </button>
            );
          })}
      </div>

      <div className="samples-section-title">Complex</div>
      <div className="samples-grid">
        {visibleComplexSamples.length === 0 && <div className="samples-empty">No samples in this category.</div>}
        {visibleComplexSamples.map((sample) => {
            const isActive = currentCode === sample.code;
            return (
              <button
                key={sample.id}
                type="button"
                className={`sample-card ${isActive ? "is-active" : ""}`}
                onClick={() => handleSampleClick(sample.code)}
              >
                <span className="sample-category">{sample.category}</span>
                <span className="sample-name">{sample.name}</span>
                <span className="sample-desc">{sample.description}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
