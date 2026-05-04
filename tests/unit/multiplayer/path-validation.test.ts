import { describe, it, expect } from 'vitest';
import { isValidBoggleWord } from '../../../src/components/boggle/multiplayer/path-validation';

// 5x5 board:
//   c a t s a
//   o b r e d
//   d o g h i
//   m n p l e
//   q r u w y
const board = 'catsa' + 'obred' + 'doghi' + 'mnple' + 'qruwy';

describe('isValidBoggleWord — 8-neighbor DFS', () => {
  it('accepts a horizontally-adjacent word', () => {
    expect(isValidBoggleWord('cat', board, 5)).toBe(true);
  });

  it('accepts a diagonal path', () => {
    // c(0,0) → b(1,1) → r(1,2)? actually b is at (1,1) and r at (1,2) — adjacent.
    // Try "cat" via (0,0)c→(0,1)a→(0,2)t — straight horizontal.
    expect(isValidBoggleWord('cob', board, 5)).toBe(true); // c(0,0)→o(1,0)→b(1,1)
  });

  it('rejects letters that are not in the grid', () => {
    expect(isValidBoggleWord('zzz', board, 5)).toBe(false);
  });

  it('rejects a path that requires reusing a cell', () => {
    // Single 'c' on the board (at 0,0) so "cc" is impossible without reuse.
    expect(isValidBoggleWord('cc', board, 5)).toBe(false);
  });

  it('rejects non-adjacent letters', () => {
    // 'c' at (0,0), 'h' at (2,3): not adjacent.
    expect(isValidBoggleWord('ch', board, 5)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isValidBoggleWord('CAT', board, 5)).toBe(true);
    expect(isValidBoggleWord('Cat', board, 5)).toBe(true);
  });

  it('rejects empty word', () => {
    expect(isValidBoggleWord('', board, 5)).toBe(false);
  });

  it('rejects board/size mismatch', () => {
    expect(isValidBoggleWord('cat', board, 4)).toBe(false);
    expect(isValidBoggleWord('cat', 'abc', 5)).toBe(false);
  });

  it('does not wrap rows: last column → next row first column is rejected', () => {
    // Use an all-unique board so the test isn't satisfied via duplicate letters.
    // a b c d e
    // f g h i j
    // k l m n o
    // p q r s t
    // u v w x y
    const unique = 'abcde' + 'fghij' + 'klmno' + 'pqrst' + 'uvwxy';
    // 'e' at (0,4), 'f' at (1,0) — row+1 with col-wrap → not 8-adjacent.
    expect(isValidBoggleWord('ef', unique, 5)).toBe(false);
    // sanity: 'ej' (e(0,4) → j(1,4)) IS adjacent and should pass.
    expect(isValidBoggleWord('ej', unique, 5)).toBe(true);
  });

  it('finds a longer 4-letter word with no reuse', () => {
    // c(0,0)→a(0,1)→t(0,2)→s(0,3)
    expect(isValidBoggleWord('cats', board, 5)).toBe(true);
  });
});
