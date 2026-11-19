import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { APP_NAME } from "./src/app.ts";

// Relative base: the same build works at https://<user>.github.io/addatracer/, on a custom domain (add public/CNAME),
// or locally, with no change here.
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "app-name",
      transformIndexHtml: (html) => html.replaceAll("%APP_NAME%", APP_NAME),
    },
    {
      // public/_local holds private test clips for the dev server (git-ignored). Never ship them.
      name: "drop-local-clips",
      apply: "build",
      closeBundle() {
        rmSync(resolve(import.meta.dirname, "dist/_local"), { recursive: true, force: true });
      },
    },
  ],
});
