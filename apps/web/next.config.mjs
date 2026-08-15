/** @type {import('next').NextConfig} */
const config = {
  // The shared contracts are TypeScript source in a workspace package, not a built
  // bundle. Next compiles them itself rather than requiring a separate build step, which
  // keeps `pnpm dev` from needing the packages compiled first.
  transpilePackages: ["@corpus-lens/shared"],
  reactStrictMode: true,
};

export default config;
