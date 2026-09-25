import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // Using a variable that was never declared. Plain JavaScript has no
      // compiler to catch it, and Next's preset leaves this rule off — which is
      // how `booking.mode` in the booking wizard and `site` in the video call's
      // error screen both shipped. Each one only crashed when that screen was
      // actually opened, so nothing short of this rule found them.
      "no-undef": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
