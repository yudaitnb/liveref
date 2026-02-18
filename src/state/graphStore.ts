import { create } from "zustand";

type Pos = { x: number; y: number };

type GraphState = {
  nodePos: Record<string, Pos>;
  setNodePos: (id: string, pos: Pos) => void;
  resetPos: () => void;
};

export const useGraphStore = create<GraphState>((set) => ({
  nodePos: {},
  setNodePos: (id, pos) => set((s) => ({ nodePos: { ...s.nodePos, [id]: pos } })),
  resetPos: () => set({ nodePos: {} }),
}));
