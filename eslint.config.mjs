import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type-aware linting (needed by no-floating-promises / no-misused-promises).
    // Plain JS files (scripts/*.mjs) are outside tsconfig, so they opt out below.
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fire-and-forget must be explicit: await it, `.catch` it, or `void` it with
      // a comment saying where the error is handled.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        // React event handlers / JSX props may be async; the rest stays strict.
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Strict no-any enforcement
      "@typescript-eslint/no-explicit-any": "error",

      // Allow empty interfaces extending other types (ShadCN pattern)
      "@typescript-eslint/no-empty-object-type": "off",

      // Allow triple-slash references (Next.js generates these)
      "@typescript-eslint/triple-slash-reference": "off",

      // setState in useEffect is valid for syncing external state
      "react-hooks/set-state-in-effect": "off",

      // Date.now() in render is acceptable for streaming indicators
      "react-hooks/purity": "off",

      // Allow unused vars with _ prefix
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Catch unsafe patterns
      "@typescript-eslint/no-unsafe-assignment": "off", // too noisy with Drizzle
      "@typescript-eslint/no-unsafe-member-access": "off",

      // Allow empty catch blocks (used for fire-and-forget)
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Prefer const
      "prefer-const": "error",

      // No var
      "no-var": "error",

      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".vite/**",
      "drizzle/**",
      "*.config.ts",
      "*.config.mjs",
      "tailwind.config.ts",
      "next.config.*",
      "vitest.config.*",
      "postcss.config.*",
    ],
  }
);
