// The unique-vs-shared scoring rule from PLAN_MULTIPLAYER §2.
//
// For each word in the union of all players' found words:
//   if exactly one player found it → 1 point to that player (v1: flat).
//   if two or more found it        → 0 points to anyone.
//
// Returns one row per player plus the winnerIds list (ties share rank 1).

import type { PlayerState, ResultsPayload, ResultsRow } from './protocol';

export const computeResults = (
  players: Record<string, PlayerState>,
): ResultsPayload => {
  const playerEntries = Object.values(players);

  // Tally how many players found each word (canonical lowercase).
  const wordCounts = new Map<string, number>();
  for (const p of playerEntries) {
    for (const w of p.foundWords) {
      const key = w.toLowerCase();
      wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
    }
  }

  // Per-player partition: unique vs shared.
  const rows: ResultsRow[] = playerEntries.map((p) => {
    const unique: string[] = [];
    const shared: string[] = [];
    for (const w of p.foundWords) {
      const count = wordCounts.get(w.toLowerCase()) ?? 0;
      if (count === 1) unique.push(w);
      else shared.push(w);
    }
    return {
      playerId: p.id,
      displayName: p.displayName,
      foundWords: [...p.foundWords],
      uniqueWords: unique,
      sharedWords: shared,
      points: unique.length, // v1: flat 1-per-unique
      rank: 0, // assigned below
    };
  });

  // Rank by points desc; ties share the lower rank (1, 1, 3, ...).
  rows.sort((a, b) => b.points - a.points);
  let lastPoints = Number.NaN;
  let lastRank = 0;
  rows.forEach((row, i) => {
    if (row.points !== lastPoints) {
      lastRank = i + 1;
      lastPoints = row.points;
    }
    row.rank = lastRank;
  });

  const topPoints = rows.length > 0 ? rows[0].points : 0;
  const winnerIds =
    topPoints > 0
      ? rows.filter((r) => r.points === topPoints).map((r) => r.playerId)
      : [];

  return { perPlayer: rows, winnerIds };
};
