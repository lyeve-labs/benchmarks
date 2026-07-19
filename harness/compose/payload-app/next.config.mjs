import path from 'path';
import { fileURLToPath } from 'url';
import { withPayload } from '@payloadcms/next/withPayload';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This is a throwaway benchmark app, not a codebase we ship. Skip the type-check
  // and lint passes at build time: they add minutes and aren't what we're testing.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Resolve the `@payload-config` bare import to the actual config file. Setting
  // it on the webpack alias directly is more reliable than relying on tsconfig
  // path mapping being picked up by Next's bundler.
  webpack: (config) => {
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@payload-config'] = path.resolve(dirname, 'src/payload.config.ts');
    return config;
  },
};

export default withPayload(nextConfig);
