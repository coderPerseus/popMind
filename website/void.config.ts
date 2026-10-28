import { defineConfig } from "void/config";

export default defineConfig({
  // A static site: every page is prerendered at build time.
  output: "static",
  head: {
    htmlAttrs: { lang: "zh-CN" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#ffffff" },
    ],
    // The hz type: Inter and Noto Sans SC for text, Nunito for titles. Loaded without holding the page
    // (media="print" until it arrives): where Google Fonts is out of reach, as in mainland China, the page
    // shows at once in the system's fonts (PingFang SC).
    link: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Nunito:wght@500;700&family=Noto+Sans+SC:wght@400;500;700&family=JetBrains+Mono&display=swap",
        media: "print",
        onload: "this.media='all'",
      },
    ],
  },
  worker: {
    compatibility_date: "2026-02-24",
  },
  cloudflare: {
    name: "popmind",
    workers_dev: true,
    preview_urls: true,
  },
});
