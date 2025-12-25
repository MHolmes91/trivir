module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    "coverage/",
    ".turbo/",
    ".cache/",
    ".parcel-cache/",
    "bun.lock",
  ],
  rules: {
    indent: ["error", 2],
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
  },
};
