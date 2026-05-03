import { defineConfig } from 'vite';
import { qwikVite } from '@builder.io/qwik/optimizer';
import { qwikCity } from '@builder.io/qwik-city/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import wasm from 'vite-plugin-wasm';
import wasmPack from 'vite-plugin-wasm-pack';
import topLevelAwait from 'vite-plugin-top-level-await';

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
  };
});
