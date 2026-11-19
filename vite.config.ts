import { defineConfig } from "vite";

// Relative base so the same build works at https://<user>.github.io/flighted/, on a custom domain, or locally.
export default defineConfig({
  base: "./",
});
