import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Hermetic: ignore whatever the shell (or scripts/verify.sh) exported.
    env: {
      TRACKER_STORE: "memory",
      AGENT_WEBHOOK_URL: "",
      TRACKER_WEBHOOK_SECRET: "",
      TRACKER_API_KEY: "",
      CRON_SECRET: "",
      TRACKER_BASE_URL: "",
      WEBHOOK_RETRY_DELAYS_MS: "",
    },
  },
});
