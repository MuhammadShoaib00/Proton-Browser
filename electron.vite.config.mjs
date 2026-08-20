import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const r = (...p) => resolve(__dirname, ...p)

export default defineConfig({
  main: {
    // Keep runtime deps (sharp, ffmpeg-static, electron-updater, ytdl, axios…)
    // and the native .node addon as runtime require()s instead of bundling them.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: r('src/main/index.js'),
        // .node native addon + optional deps that are require()'d in try/catch
        // and may not be installed — keep them as runtime require()s.
        external: [/\.node$/, 'axios', 'webtorrent']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        // Two preloads: the chrome-window preload and the per-tab page preload.
        input: {
          index: r('src/preload/index.js'),
          'page-preload': r('src/preload/page-preload.js')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: r('src/renderer'),
    // Logos live in src/renderer/public and are served at the web root
    // (/logo.png …) in dev and copied into the renderer build for production.
    // (Vite's default publicDir = <root>/public.)
    build: {
      outDir: r('out/renderer'),
      rollupOptions: {
        input: r('src/renderer/index.html')
      }
    }
  }
})
