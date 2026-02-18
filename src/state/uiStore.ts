import { create } from "zustand";

type UIState = {
  selectedLocId: string | null;
  selectedStep: number;

  setSelectedLocId: (locId: string | null) => void;
  setSelectedStep: (step: number) => void;
};

export const useUIStore = create<UIState>((set) => ({
  selectedLocId: null,
  selectedStep: 0,

  setSelectedLocId: (locId) => set({ selectedLocId: locId }),
  setSelectedStep: (step) => set({ selectedStep: step }),
}));
