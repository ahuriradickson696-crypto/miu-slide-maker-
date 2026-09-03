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
    nitro({
      preset: "vercel",
      vercel: {
        // Deck generation for large slide counts can take a while even with
        // batching. Raise the ceiling so Vercel doesn't kill the function
        // mid-request (that "crash" is a 504 timeout, not an app bug).
        functions: { maxDuration: 60 },
      },
    }),
    viteReact(),
  ],
});
