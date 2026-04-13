import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts", "src/phx_channel/tests/**/*.test.ts"],
    exclude: ["__tests__/contract/**", "src/phx_channel/tests/channel.test.ts"],
    testTimeout: 60000,
  },
});
