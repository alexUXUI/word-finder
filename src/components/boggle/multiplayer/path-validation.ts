// Server-side Boggle path check. Symmetric to the client's `updatePath`
// 8-neighbor rule in `logic/board.ts`, but expressed as a pure DFS so the
// DO can validate independently of any client claim.
//
// Comparisons are case-insensitive on both word and board.

export const isValidBoggleWord = (
  word: string,
  board: string,
  size: number,
): boolean => {
  if (size <= 0) return false;
  if (board.length !== size * size) return false;
  const target = word.toLowerCase();
  if (target.length === 0) return false;

  const grid = board.toLowerCase().split('');

  const neighbors = (i: number): number[] => {
    const r = Math.floor(i / size);
    const c = i % size;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          out.push(nr * size + nc);
        }
      }
    }
    return out;
  };

  const dfs = (cellIdx: number, wordIdx: number, visited: Set<number>): boolean => {
    if (grid[cellIdx] !== target[wordIdx]) return false;
    if (wordIdx === target.length - 1) return true;
    visited.add(cellIdx);
    for (const n of neighbors(cellIdx)) {
      if (!visited.has(n) && dfs(n, wordIdx + 1, visited)) return true;
    }
    visited.delete(cellIdx);
    return false;
  };

  for (let i = 0; i < grid.length; i++) {
    if (dfs(i, 0, new Set())) return true;
  }
  return false;
};
