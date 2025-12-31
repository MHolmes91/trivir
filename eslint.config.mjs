import js from "@eslint/js";
import globals from "globals";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "coverage/",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      ".turbo/",
      ".cache/",
      ".parcel-cache/",
      "bun.lock",
      "playwright/.generated/",
      "playwright/test-results/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      indent: ["error", 2],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
    },
  },
];
