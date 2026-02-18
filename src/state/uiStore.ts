import { create } from "zustand";

type UIState = {
  selectedCheckpointId: string | null;
  selectedStep: number;
  selectedVarName: string | null;

  setSelectedCheckpointId: (checkpointId: string | null) => void;
  setSelectedStep: (step: number) => void;
  setSelectedVarName: (name: string | null) => void;
  resetUI: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  selectedCheckpointId: null,
  selectedStep: 0,
  selectedVarName: null,

  setSelectedCheckpointId: (checkpointId) => set({ selectedCheckpointId: checkpointId }),
  setSelectedStep: (step) => set({ selectedStep: step }),
  setSelectedVarName: (name) => set({ selectedVarName: name }),
  resetUI: () => set({ selectedCheckpointId: null, selectedStep: 0, selectedVarName: null }),
}));
