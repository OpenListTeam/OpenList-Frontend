import path from "path"
import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import legacy from "@vitejs/plugin-legacy"
import { dynamicBase } from "vite-plugin-dynamic-base"
import copy from "rollup-plugin-copy"

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
      // "@solidjs/router": path.resolve(__dirname, "solid-router/src"),
      "solid-icons": path.resolve(__dirname, "node_modules/solid-icons"),
    },
  },
  plugins: [
    solidPlugin(),
    legacy({
      targets: ["defaults"],
    }),
    dynamicBase({
      // dynamic public path var string, default window.__dynamic_base__
      publicPath: " window.__dynamic_base__",
      // dynamic load resources on index.html, default false. maybe change default true
      transformIndexHtml: true,
      transformIndexHtmlConfig: {
        insertBodyAfter: true,
      },
    }),
    process.env.VITE_LITE !== "true"
      ? copy({
          targets: [
            {
              src: "node_modules/monaco-editor/min",
              dest: "dist/static/monaco-editor",
            },
            {
              src: "node_modules/katex/dist/katex.min.css",
              dest: "dist/static/katex",
            },
            {
              src: "node_modules/katex/dist/fonts",
              dest: "dist/static/katex/fonts",
            },
            {
              src: "node_modules/mermaid/dist/mermaid.min.js",
              dest: "dist/static/mermaid",
            },
            {
              src: "node_modules/@ruffle-rs/ruffle/*.{js,wasm}",
              dest: "dist/static/ruffle",
            },
            {
              src: "node_modules/libheif-js/libheif-wasm/libheif.{js,wasm}",
              dest: "dist/static/libheif",
            },
          ],
          hook: "writeBundle",
        })
      : null,
  ],
  base: process.env.NODE_ENV === "production" ? "/__dynamic_base__/" : "/",
  // base: "/",
  build: {
    // target: "es2015", //next
    // polyfillDynamicImport: false,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((name) => name.endsWith("pdf.worker.min.mjs"))
            ? "assets/[name]-[hash].js"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  // experimental: {
  //   renderBuiltUrl: (filename, { type, hostId, hostType }) => {
  //     if (type === "asset") {
  //       return { runtime: `window.OPENLIST_CONFIG.cdn/${filename}` };
  //     }
  //     return { relative: true };
  //   },
  // },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:5244",
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
})
