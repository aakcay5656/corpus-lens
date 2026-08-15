/** @type {import('next').NextConfig} */
const config = {
  // No `transpilePackages` here, deliberately.
  //
  // The workspace packages are consumed through their `exports` map, which points at the
  // compiled CJS in `dist/`. Listing them for transpilation makes Next treat that built
  // output as first-party source and run its React Refresh transform over it, which
  // injects `import.meta.webpackHot` into a CommonJS file — every page importing
  // `@corpus-lens/shared` then 500s in dev with "Cannot use 'import.meta' outside a
  // module". Production builds were unaffected, because Refresh is a dev-only transform,
  // which is exactly why this survived until the README was run end to end.
  //
  // Left out, webpack resolves them as ordinary dependencies and consumes the CJS as-is.
  reactStrictMode: true,
};

export default config;
