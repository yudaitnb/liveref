// src/trace/locMap.ts
// MVP: ダミー。後で Babel 由来の loc (start/end) に差し替える。

export type LocRange = {
  locId: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
};

// エディタ表示用：この範囲に “計測ポイント” の印を出す
export const dummyLocRanges: LocRange[] = [
  // ここは EditorPane の初期コードに合わせて調整
  { locId: "L1", startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
  { locId: "L2", startLine: 6, startCol: 1, endLine: 6, endCol: 1 },
  { locId: "L3", startLine: 8, startCol: 1, endLine: 8, endCol: 1 },
  { locId: "L4", startLine: 10, startCol: 1, endLine: 10, endCol: 1 },
];
