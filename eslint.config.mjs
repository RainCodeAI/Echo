import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat config (ESLint 9 / Next 16).
 *
 * `next lint` was removed in Next 16, and ESLint 9 defaults to flat config,
 * so we consume eslint-config-next's flat array (which already bundles the
 * TypeScript, React, hooks, jsx-a11y, and import plugins) directly.
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "convex/_generated/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // react-hooks v6 ships this as an error, but it over-flags accepted
      // patterns we rely on: hydrating local state from a Convex query,
      // resetting draft state when props change, and SSR-safe browser-capability
      // detection on mount. Keep it as an advisory rather than a build blocker.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
