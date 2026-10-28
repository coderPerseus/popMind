import { defineConfig } from "vite";
import { voidPlugin } from "void";
import { voidSolid } from "@void/solid/plugin";

export default defineConfig({
  plugins: [voidPlugin(), voidSolid({ prefetch: { cacheFor: "5m" } })],
});
