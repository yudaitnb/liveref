import { create } from "zustand";
import { defaultSample } from "../samples/catalog";

type CodeState = {
  code: string;
  sampleRevision: number;
  setCode: (code: string) => void;
  setSampleCode: (code: string) => void;
};

export const useCodeStore = create<CodeState>((set) => ({
  code: defaultSample.code,
  sampleRevision: 0,
  setCode: (code) => set({ code }),
  setSampleCode: (code) =>
    set((s) => ({
      code,
      sampleRevision: s.sampleRevision + 1,
    })),
}));
