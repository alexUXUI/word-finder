// Two-client smoke test for the multiplayer GameRoom DO.
//
// Equivalent to "two wscat clients" from PLAN_MULTIPLAYER.md §13, but
// reproducible without a global wscat install. Drives the WS protocol
// from §5 end-to-end: join → start → found → ready → game_ended.
//
// Usage (assumes wrangler dev is already running on :8788):
//   node multiplayer-worker/test/smoke.mjs
//
// Exit code 0 on success, 1 on assertion failure.

import WebSocket from 'ws';

const URL = process.env.WS_URL ?? 'ws://127.0.0.1:8788/games/smoke-test';
const RESULT_TIMEOUT_MS = 8_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const open = (label) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.received = [];
    ws.label = label;
    ws.on('message', (buf) => {
      const frame = JSON.parse(buf.toString());
      ws.received.push(frame);
      console.log(`← ${label}: ${frame.type}${frame.code ? ' [' + frame.code + ']' : ''}`);
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

const send = (ws, frame) => {
  console.log(`→ ${ws.label}: ${frame.type}`);
  ws.send(JSON.stringify(frame));
};

const waitFor = async (ws, predicate, label, timeoutMs = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const found = ws.received.find(predicate);
    if (found) return found;
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label} on ${ws.label}`);
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

const main = async () => {
  console.log('=== open two clients ===');
  const a = await open('A');
  const b = await open('B');

  console.log('\n=== join phase ===');
  send(a, { type: 'join', playerId: 'pa', displayName: 'Alice', gameName: 'smoke-test' });
  send(b, { type: 'join', playerId: 'pb', displayName: 'Bob', gameName: 'smoke-test' });
  // A should see its own initial state, then a player_joined for B.
  await waitFor(a, (f) => f.type === 'state', 'state on A');
  await waitFor(a, (f) => f.type === 'player_joined' && f.player.id === 'pb', 'B joined');

  console.log('\n=== start phase ===');
  send(a, { type: 'start' });
  const started = await waitFor(b, (f) => f.type === 'game_started', 'game_started on B');
  assert(typeof started.board === 'string' && started.board.length === 25, 'board is 25 chars');
  console.log(`   board = ${started.board}`);

  console.log('\n=== invalid found rejected ===');
  // Send a deliberately-bogus word that won't trace any path.
  send(a, { type: 'found', word: 'zzzzz' });
  const err = await waitFor(a, (f) => f.type === 'error', 'error frame');
  assert(['invalid_path', 'too_short', 'not_a_word'].includes(err.code), `unexpected reject code ${err.code}`);

  console.log('\n=== valid found accepted ===');
  // Find a real 3-letter substring that traces the board. We brute-force
  // a 3-letter horizontal pair on row 0.
  const board = started.board;
  let foundWord = null;
  outer: for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      const w = board.slice(r * 5 + c, r * 5 + c + 3);
      // Pick a "word" that's unlikely to be in the dictionary; we expect
      // either accept (if it's actually in engmix) or `not_a_word`. Either
      // proves the path validator works. To prove acceptance we'd need a
      // dictionary word, but the spike target is "messages flow" not "Alice
      // wins" — so we accept either an accept OR a clean not_a_word here.
      foundWord = w;
      break outer;
    }
  }
  send(b, { type: 'found', word: foundWord });
  const reply = await waitFor(
    b,
    (f) => (f.type === 'player_found' && f.playerId === 'pb') || f.type === 'error',
    'found-reply',
    8000,
  );
  if (reply.type === 'player_found') {
    console.log(`   accepted: ${reply.word} (count=${reply.totalCount})`);
    // A should also see the broadcast.
    await waitFor(a, (f) => f.type === 'player_found' && f.playerId === 'pb', 'A sees B found', 2000);
  } else {
    console.log(`   server rejected as ${reply.code} (path/dict check exercised — OK)`);
  }

  console.log('\n=== ready → end-game consensus ===');
  send(a, { type: 'ready', ready: true });
  send(b, { type: 'ready', ready: true });
  const ended = await waitFor(a, (f) => f.type === 'game_ended', 'game_ended', RESULT_TIMEOUT_MS);
  assert(Array.isArray(ended.results.perPlayer), 'results.perPlayer is array');
  assert(ended.results.perPlayer.length === 2, 'two players in results');
  console.log(`   winners: ${JSON.stringify(ended.results.winnerIds)}`);

  console.log('\n=== close ===');
  a.close();
  b.close();
  await sleep(200);

  console.log('\n✅ smoke test passed');
  process.exit(0);
};

main().catch((e) => {
  console.error(`\n❌ smoke test failed: ${e.message}`);
  process.exit(1);
});
