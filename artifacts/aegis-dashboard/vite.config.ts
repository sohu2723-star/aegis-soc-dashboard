import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "5000";
const port = Number(rawPort);

const basePath = process.env.BASE_PATH ?? "/";

const localApiUrl = `http://localhost:${process.env.API_PORT ?? 3000}`;
const renderApiUrl = "https://aegis-api-server-jp3b.onrender.com";

async function resolveApiUrl() {
  // An explicit URL is always authoritative for CI, preview, or a custom
  // deployment. Otherwise prefer the local API when it is already running.
  if (process.env.VITE_API_URL) return process.env.VITE_API_URL;

  try {
    const response = await fetch(`${localApiUrl}/api/ping`, {
      signal: AbortSignal.timeout(1200),
    });
    if (response.ok) return localApiUrl;
  } catch {
    // The local API may be intentionally absent in the Replit editor preview.
  }

  // Keep the dashboard usable when the local API workflow is unavailable.
  // Render is the deployed API and exposes the same /api routes, including
  // the SSE stream used by the live notification path.
  return renderApiUrl;
}

const apiUrl = await resolveApiUrl();

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,      // disable source maps in production — code stays minified
    minify: "esbuild",
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
