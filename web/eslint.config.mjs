import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generado por Storybook
    "storybook-static/**",
  ]),
  // Ajustes de reglas:
  //   - set-state-in-effect: regla muy nueva que rompe el patrón legítimo de
  //     hidratar estado desde localStorage en useEffect. La dejamos como warn.
  //   - no-unescaped-entities: estilística (entidades HTML); warn.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
