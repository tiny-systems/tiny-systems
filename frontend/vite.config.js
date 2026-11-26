import { defineConfig } from 'vite';

// `vite build` makes the desktop app's frontend. `vite build --mode web`
// makes the same frontend for a web page (the demo on tinysystems.io):
// web/shim.js stands in for the Go backend and web/demo.json, written
// from demo.go, is its data.
export default defineConfig(({ mode }) => mode === 'web'
  ? {
      base: './',
      publicDir: 'web',
      build: { outDir: '../build/web', emptyOutDir: true, target: 'safari15' },
      plugins: [{
        name: 'web-shim',
        transformIndexHtml: (html) => html.replace('<head>', '<head>\n  <script src="./shim.js"></script>'),
      }],
    }
  : { publicDir: false, build: { outDir: 'dist', emptyOutDir: true, target: 'safari15' } });
