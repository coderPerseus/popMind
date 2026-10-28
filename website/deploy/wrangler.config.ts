import { defineWranglerConfig } from "wrangler/experimental-config";

// The site's static build, made by `bun run build` in website/.
export default defineWranglerConfig({
  assetsDirectory: "../dist/client",
});
