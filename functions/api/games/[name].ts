/**
 * Cloudflare Pages Function: WebSocket upgrade → multiplayer GameRoom DO.
 *
 * Browser opens `wss://word-finder-eak.pages.dev/api/games/<game-name>`.
 * This Function forwards the upgrade request to the GameRoom DO instance
 * (keyed by lowercased game name) hosted in the `word-finder-multiplayer`
 * Worker. See docs/PLAN_MULTIPLAYER.md §3 — the DO class can't live in a
 * Pages project, so it lives in a separate Worker that this binds to.
 */

interface PagesEnv {
  GAME_ROOM: DurableObjectNamespace;
}

export const onRequest: PagesFunction<PagesEnv> = async ({ request, env, params }) => {
  const upgrade = request.headers.get('Upgrade');
  if (upgrade !== 'websocket') {
    return new Response('expected WebSocket Upgrade', { status: 426 });
  }
  const raw = Array.isArray(params.name) ? params.name[0] : params.name;
  const gameName = (raw ?? '').toString().toLowerCase();
  if (!gameName) return new Response('empty game name', { status: 400 });

  const id = env.GAME_ROOM.idFromName(gameName);
  const stub = env.GAME_ROOM.get(id);
  return stub.fetch(request);
};
