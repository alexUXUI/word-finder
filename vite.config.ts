import { defineConfig } from 'vite';
import { qwikVite } from '@builder.io/qwik/optimizer';
import { qwikCity } from '@builder.io/qwik-city/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import wasm from 'vite-plugin-wasm';
import wasmPack from 'vite-plugin-wasm-pack';
import topLevelAwait from 'vite-plugin-top-level-await';
import { execSync } from 'node:child_process';

// Resolve version metadata at vite-config load time. Cloudflare Pages
// exposes its own env vars in the build container; fall back to a local
// `git` invocation for `yarn dev` / `yarn start`.
const safeExec = (cmd: string, fallback: string): string => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
};
const fullSha =
  process.env.CF_PAGES_COMMIT_SHA ||
  safeExec('git rev-parse HEAD', 'unknown');
const branch =
  process.env.CF_PAGES_BRANCH ||
  safeExec('git rev-parse --abbrev-ref HEAD', 'unknown');
const buildTime = new Date().toISOString();
const sha = (fullSha || 'unknown').slice(0, 7);

// Cross-Origin Isolation headers — required for SharedArrayBuffer (Transformers.js
// WebAssembly multithreaded inference) and recommended for WebGPU device access.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(() => {
  return {
    plugins: [
      qwikCity(),
      qwikVite(),
      tsconfigPaths(),
      wasmPack('./src/components/boggle/boggle-solver'),
      wasm(),
    ],
    worker: {
      format: 'es',
      plugins: [wasm(), topLevelAwait()],
    },
    server: {
      headers: crossOriginIsolationHeaders,
    },
    preview: {
      headers: {
        'Cache-Control': 'public, max-age=600',
        ...crossOriginIsolationHeaders,
      },
    },
    // @huggingface/transformers is large and pulls in onnxruntime-web; skip
    // dev-server pre-bundling to avoid long startup pauses. The runtime
    // dynamic import path still works correctly.
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
    // Build-time version constants. Replaced verbatim in both client and
    // server bundles so SSR + hydration agree on the value.
    define: {
      __APP_VERSION_SHA__: JSON.stringify(sha),
      __APP_VERSION_FULL_SHA__: JSON.stringify(fullSha),
      __APP_VERSION_BRANCH__: JSON.stringify(branch),
      __APP_VERSION_BUILD_TIME__: JSON.stringify(buildTime),
    },
  };
});
