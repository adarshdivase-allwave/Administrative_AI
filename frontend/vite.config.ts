import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        name: "AV Inventory",
        short_name: "AV Inv",
        description:
          "AV Integration Inventory & Operations Management Platform — India GST / MSMED / Tally compliant.",
        theme_color: "#0f172a",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        orientation: "portrait",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Never cache GraphQL or authenticated AppSync calls; always go to network.
        navigateFallbackDenylist: [/\/graphql/, /\/auth\//],
        runtimeCaching: [
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|gif)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /\.(?:js|css)$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "asset-cache" },
          },
        ],
      },
      devOptions: {
        enabled: false, // opt-in only during dev; heavy on HMR
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split vendor chunks for better long-term caching.
        // We intentionally don't separate a `radix` chunk — Amplify UI pulls
        // its own Radix deps and chunking them separately creates a cycle.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          amplify: ["aws-amplify", "@aws-amplify/ui-react"],
          charts: ["recharts"],
          table: ["@tanstack/react-table", "@tanstack/react-virtual"],
        },
      },
    },
  },
});
