import { onRequest as __api_games__name__ts_onRequest } from "/Users/alexbennett/Desktop/boggle/functions/api/games/[name].ts"
import { onRequest as __api_profile___path___ts_onRequest } from "/Users/alexbennett/Desktop/boggle/functions/api/profile/[[path]].ts"
import { onRequestOptions as __api_llm_ts_onRequestOptions } from "/Users/alexbennett/Desktop/boggle/functions/api/llm.ts"
import { onRequestPost as __api_llm_ts_onRequestPost } from "/Users/alexbennett/Desktop/boggle/functions/api/llm.ts"
import { onRequest as ____path___ts_onRequest } from "/Users/alexbennett/Desktop/boggle/functions/[[path]].ts"

export const routes = [
    {
      routePath: "/api/games/:name",
      mountPath: "/api/games",
      method: "",
      middlewares: [],
      modules: [__api_games__name__ts_onRequest],
    },
  {
      routePath: "/api/profile/:path*",
      mountPath: "/api/profile",
      method: "",
      middlewares: [],
      modules: [__api_profile___path___ts_onRequest],
    },
  {
      routePath: "/api/llm",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_llm_ts_onRequestOptions],
    },
  {
      routePath: "/api/llm",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_llm_ts_onRequestPost],
    },
  {
      routePath: "/:path*",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [____path___ts_onRequest],
    },
  ]