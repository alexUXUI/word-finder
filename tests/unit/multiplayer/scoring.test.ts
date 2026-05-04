import { describe, it, expect } from 'vitest';
import { computeResults } from '../../../src/components/boggle/multiplayer/scoring';
import type { PlayerState } from '../../../src/components/boggle/multiplayer/protocol';

const player = (id: string, words: string[], over: Partial<PlayerState> = {}): PlayerState => ({
  id,
  displayName: id,
  joinedAt: 0,
  foundWords: words,
  readyToEnd: false,
  lastSeenAt: 0,
  connected: true,
  ...over,
});

describe('computeResults — unique vs shared scoring', () => {
  it('awards 1 point per unique word and 0 for shared words', () => {
    const players = {
      a: player('a', ['cat', 'dog', 'whisper']),
      b: player('b', ['cat', 'fish', 'graphite']),
    };
    const r = computeResults(players);
    const a = r.perPlayer.find((p) => p.playerId === 'a')!;
    const b = r.perPlayer.find((p) => p.playerId === 'b')!;
    expect(a.points).toBe(2); // dog + whisper
    expect(b.points).toBe(2); // fish + graphite
    expect(a.sharedWords).toEqual(['cat']);
    expect(b.sharedWords).toEqual(['cat']);
    expect(a.uniqueWords.sort()).toEqual(['dog', 'whisper']);
  });

  it('marks the higher-points player as winner; rank starts at 1', () => {
    const players = {
      a: player('a', ['cat', 'dog', 'whisper', 'graphite']),
      b: player('b', ['cat', 'dog']), // both shared
    };
    const r = computeResults(players);
    expect(r.winnerIds).toEqual(['a']);
    expect(r.perPlayer[0].playerId).toBe('a');
    expect(r.perPlayer[0].rank).toBe(1);
    expect(r.perPlayer[1].rank).toBe(2);
  });

  it('shares rank 1 across ties, lists every winner', () => {
    const players = {
      a: player('a', ['ax', 'unique-a']),
      b: player('b', ['bx', 'unique-b']),
      c: player('c', ['ax', 'bx']), // entirely shared with others → 0 points
    };
    const r = computeResults(players);
    expect(r.winnerIds.sort()).toEqual(['a', 'b']);
    const a = r.perPlayer.find((p) => p.playerId === 'a')!;
    const b = r.perPlayer.find((p) => p.playerId === 'b')!;
    const c = r.perPlayer.find((p) => p.playerId === 'c')!;
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(1);
    expect(c.rank).toBe(3); // ties share lower rank, next is i+1
    expect(c.points).toBe(0);
  });

  it('three players all sharing one word: nobody scores from that word', () => {
    const players = {
      a: player('a', ['the']),
      b: player('b', ['the']),
      c: player('c', ['the']),
    };
    const r = computeResults(players);
    expect(r.winnerIds).toEqual([]); // nobody has > 0 points
    for (const row of r.perPlayer) {
      expect(row.points).toBe(0);
      expect(row.sharedWords).toEqual(['the']);
      expect(row.uniqueWords).toEqual([]);
    }
  });

  it('canonicalizes case: WORD and word collide as the same word', () => {
    const players = {
      a: player('a', ['Whisper', 'graphite']),
      b: player('b', ['WHISPER']),
    };
    const r = computeResults(players);
    const a = r.perPlayer.find((p) => p.playerId === 'a')!;
    const b = r.perPlayer.find((p) => p.playerId === 'b')!;
    expect(a.sharedWords.map((w) => w.toLowerCase())).toEqual(['whisper']);
    expect(a.points).toBe(1); // graphite still unique
    expect(b.points).toBe(0);
  });

  it('handles a single-player game (everything is unique)', () => {
    const players = { a: player('a', ['cat', 'dog', 'whisper']) };
    const r = computeResults(players);
    expect(r.perPlayer[0].points).toBe(3);
    expect(r.winnerIds).toEqual(['a']);
  });

  it('handles a zero-player game without crashing', () => {
    const r = computeResults({});
    expect(r.perPlayer).toEqual([]);
    expect(r.winnerIds).toEqual([]);
  });
});
