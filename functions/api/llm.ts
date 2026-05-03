/**
 * Cloudflare Pages Function: server-side LLM proxy.
 *
 * Browser POSTs `{messages, maxTokens?, temperature?}` here, this Function
 * routes the call to whichever upstream is configured (Workers AI today,
 * a self-hosted Container in Phase 2 — see docs/SERVER_SLM.md), and
 * returns `{text, elapsedMs, model, upstream}`.
 *
 * Keeping the abstraction at the edge means swapping the upstream is an
 * env var change in `wrangler.toml`, not an app deploy.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

interface LlmResponse {
  text: string;
  elapsedMs: number;
  model: string;
  upstream: string;
}

interface PagesEnv {
  AI: {
    run: (
      model: string,
      input: { messages: ChatMessage[]; max_tokens?: number; temperature?: number }
    ) => Promise<{ response: string } | { result: string } | unknown>;
  };
  LLM_UPSTREAM: string;
  LLM_MODEL: string;
}

const cors = (init: ResponseInit = {}, body: BodyInit | null = null) => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'POST, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  return new Response(body, { ...init, headers });
};

const json = (status: number, body: unknown) =>
  cors({ status }, JSON.stringify(body));

export const onRequestOptions = () => cors({ status: 204 });

export const onRequestPost: PagesFunction<PagesEnv> = async ({
  request,
  env,
}) => {
  let body: LlmRequest;
  try {
    body = (await request.json()) as LlmRequest;
  } catch (e) {
    return json(400, { error: 'invalid JSON body' });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json(400, { error: 'messages must be a non-empty array' });
  }

  const upstream = env.LLM_UPSTREAM ?? 'workers-ai';
  const model = env.LLM_MODEL ?? '@cf/meta/llama-3.2-1b-instruct';
  const t0 = Date.now();

  try {
    if (upstream === 'workers-ai') {
      const result = await env.AI.run(model, {
        messages: body.messages,
        max_tokens: body.maxTokens ?? 256,
        temperature: body.temperature ?? 0.4,
      });
      // Workers AI returns { response: "..." } for chat-completion-style models.
      const text =
        (result as { response?: string }).response ??
        (result as { result?: string }).result ??
        '';
      const resp: LlmResponse = {
        text,
        elapsedMs: Date.now() - t0,
        model,
        upstream,
      };
      return json(200, resp);
    }

    if (upstream === 'self-hosted') {
      // Phase 2 placeholder. When the Container is live, swap LLM_UPSTREAM
      // to "self-hosted" and set CONTAINER_URL on the binding.
      return json(503, {
        error: 'self-hosted upstream not configured yet',
        hint: 'Phase 2 — see docs/SERVER_SLM.md',
      });
    }

    return json(500, { error: `unknown LLM_UPSTREAM: ${upstream}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { error: `upstream error: ${msg}` });
  }
};
