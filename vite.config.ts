import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const configuredBase = process.env.VITE_BASE_PATH || "./";
const base = configuredBase.replace(/\/+$/, "") + "/";

export default defineConfig({
  plugins: [vue()],
  base,
});
