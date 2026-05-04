import { describe, it, expect } from 'vitest';
import {
  parseClientFrame,
  encodeFrame,
  decodeFrame,
  type ClientFrame,
} from '../../../src/components/boggle/multiplayer/protocol';

describe('parseClientFrame — discriminated union with shape checks', () => {
  it('round-trips a join frame through encode → decode → parse', () => {
    const original: ClientFrame = {
      type: 'join',
      playerId: 'p1',
      displayName: 'Alex',
      gameName: 'sat-game',
    };
    const decoded = decodeFrame(encodeFrame(original));
    const parsed = parseClientFrame(decoded);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.frame).toEqual(original);
  });

  it('round-trips found / ready / start / heartbeat / leave', () => {
    const samples: ClientFrame[] = [
      { type: 'found', word: 'whisper' },
      { type: 'ready', ready: true },
      { type: 'start' },
      { type: 'heartbeat' },
      { type: 'leave' },
    ];
    for (const f of samples) {
      const parsed = parseClientFrame(decodeFrame(encodeFrame(f)));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.frame).toEqual(f);
    }
  });

  it('rejects frames with unknown type', () => {
    const r = parseClientFrame({ type: 'invade' });
    expect(r.ok).toBe(false);
  });

  it('rejects join with a non-string field', () => {
    const r = parseClientFrame({ type: 'join', playerId: 1, displayName: 'x', gameName: 'y' });
    expect(r.ok).toBe(false);
  });

  it('rejects ready without a boolean', () => {
    const r = parseClientFrame({ type: 'ready', ready: 'yes' });
    expect(r.ok).toBe(false);
  });

  it('decodeFrame returns null on malformed JSON, parser then rejects', () => {
    const decoded = decodeFrame('{not json');
    expect(decoded).toBeNull();
    const r = parseClientFrame(decoded);
    expect(r.ok).toBe(false);
  });
});
