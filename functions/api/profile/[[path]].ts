/**
 * Cloudflare Pages Function: catch-all proxy for /api/profile/:id[/...]
 * → PlayerProfile DO instance keyed by playerId.
 *
 * The DO sub-routes (`/favorite-board`, `/friend/:id`, `/recent/:id`) live
 * inside the DO's own fetch handler; this proxy just forwards everything
 * with the URL re-pointed at /profile/<id>/<sub-path> so the DO sees the
 * full path it matches against.
 */

interface PagesEnv {
  PROFILE: DurableObjectNamespace;
}

const cors = (status = 204) => {
  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  return new Response(null, { status, headers });
};

export const onRequest: PagesFunction<PagesEnv> = async ({ request, env, params }) => {
  if (request.method === 'OPTIONS') return cors();

  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean) as string[];
  const playerId = (segments[0] ?? '').toString();
  if (!playerId) return new Response('missing player id', { status: 400 });

  // Re-construct the URL the DO expects: /profile/<id>/<rest>
  const url = new URL(request.url);
  const rest = segments.slice(1).join('/');
  url.pathname = `/profile/${encodeURIComponent(playerId)}${rest ? '/' + rest : ''}`;
  const forwarded = new Request(url.toString(), request);

  const id = env.PROFILE.idFromName(playerId);
  const stub = env.PROFILE.get(id);
  return stub.fetch(forwarded);
};
