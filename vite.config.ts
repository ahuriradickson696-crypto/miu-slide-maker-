import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
      server: { entry: "./src/server.ts" },
    }),
    // Explicitly target Vercel. Relying on Nitro's build-time auto-detection
    // of the Vercel environment has been unreliable in practice and can
    // silently fall back to a preset Vercel can't serve, producing 404s
    // on every route.
    nitro({ preset: "vercel" }),
    viteReact(),
  ],
});
