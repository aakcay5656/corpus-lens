import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // CLAUDE.md §7: no `any`, no non-null assertions, no swallowed errors.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
  {
    // Tests may assert on values the compiler cannot narrow.
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // NestJS resolves constructor injection from `emitDecoratorMetadata`, which works by
    // emitting a *runtime* reference to each parameter's type. `import type` — and the
    // inline `{ type X }` form this config otherwise prefers — deletes exactly that
    // reference, so following the rule's advice turns `private readonly auth: AuthService`
    // into an undefined dependency.
    //
    // The failure is invisible to the compiler: it appears only when a request arrives,
    // a guard throws, and every route answers 500. That happened once in Step 8 for a
    // related reason (esbuild not emitting the metadata at all), which is why the rule is
    // switched off for this app rather than suppressed import by import.
    files: ["apps/api/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  // Must stay last: turns off every rule that would fight Prettier.
  prettier,
);
