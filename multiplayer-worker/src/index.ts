// Worker entrypoint. Routes:
//
//   /games/:name              → GameRoom DO instance keyed by game name (WS)
//   /profile/:id[/...]        → PlayerProfile DO instance keyed by playerId (HTTP)
//
// In production the Pages project's Functions
// (functions/api/games/[name].ts and functions/api/profile/[[path]].ts)
// proxy requests here via the GAME_ROOM and PROFILE bindings; this
// entrypoint is also callable directly during local dev.

import { GameRoom } from './GameRoom';
import { PlayerProfile } from './PlayerProfile';

export { GameRoom, PlayerProfile };

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  PROFILE: DurableObjectNamespace;
}

const cors = (status = 204) => {
  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  return new Response(null, { status, headers });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return cors();

    const url = new URL(request.url);

    const gameMatch = url.pathname.match(/^\/games\/([^/]+)\/?$/);
    if (gameMatch) {
      const gameName = decodeURIComponent(gameMatch[1]).toLowerCase();
      if (!gameName) return new Response('empty game name', { status: 400 });
      const id = env.GAME_ROOM.idFromName(gameName);
      return env.GAME_ROOM.get(id).fetch(request);
    }

    const profileMatch = url.pathname.match(/^\/profile\/([^/]+)/);
    if (profileMatch) {
      const playerId = decodeURIComponent(profileMatch[1]);
      if (!playerId) return new Response('empty player id', { status: 400 });
      const id = env.PROFILE.idFromName(playerId);
      return env.PROFILE.get(id).fetch(request);
    }

    return new Response(
      'multiplayer worker — try /games/:name (WS) or /profile/:id (HTTP)',
      { status: 404 },
    );
  },
};
