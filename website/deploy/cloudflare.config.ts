import { defineConfig } from "cf/config";

// popMind's website: the built static files, served by an assets-only Worker at pm.luckysnail.cn.
export default defineConfig({
  worker: {
    name: "popmind",
    compatibilityDate: "2026-10-06",
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "none" },
    domains: ["pm.luckysnail.cn"],
    workersDev: false,
  },
});
