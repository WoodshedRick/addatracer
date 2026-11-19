import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Relative base so the same build works at https://<user>.github.io/flighted/, on a custom domain, or locally.
export default defineConfig({
  base: "./",
  plugins: [
    {
      // public/_local holds private test clips for the dev server (git-ignored). Never ship them.
      name: "drop-local-clips",
      apply: "build",
      closeBundle() {
        rmSync(resolve(__dirname, "dist/_local"), { recursive: true, force: true });
      },
    },
  ],
});
