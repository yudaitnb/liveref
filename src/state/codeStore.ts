import { create } from "zustand";

type CodeState = {
  code: string;
  setCode: (code: string) => void;
};

export const useCodeStore = create<CodeState>((set) => ({
  code: "",
  setCode: (code) => set({ code }),
}));
