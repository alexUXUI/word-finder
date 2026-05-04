// Worker entrypoint. Routes /games/:name → GameRoom DO instance keyed by name.
// In production the Pages project's Function (functions/api/games/[name].ts)
// proxies WS upgrades here via the GAME_ROOM binding; this entrypoint is also
// callable directly during local dev (wrangler dev → wscat).

import { GameRoom } from './GameRoom';

export { GameRoom };

interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/games\/([^/]+)\/?$/);
    if (!match) {
      return new Response(
        'multiplayer worker — hit /games/:name to open a WS to a room',
        { status: 404 },
      );
    }
    const gameName = decodeURIComponent(match[1]).toLowerCase();
    if (!gameName) return new Response('empty game name', { status: 400 });

    const id = env.GAME_ROOM.idFromName(gameName);
    const stub = env.GAME_ROOM.get(id);
    return stub.fetch(request);
  },
};
