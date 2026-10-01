import type { NextConfig } from "next";

const isProdOrTest = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test';

// Support deployment to a subpath (e.g., /my-app)
const basePath = process.env.APP_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'standalone',
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  transpilePackages: ['@enterpriseaigroup/client', '@enterpriseaigroup/core', '@enterpriseaigroup/platform-sdk'],
  compress: true,
  turbopack: {
    resolveAlias: {
      // Ensure @tanstack/react-query from packages/client uses the same instance as the main app
      '@tanstack/react-query': './node_modules/@tanstack/react-query',
    },
    rules: {
      // Fix Zustand ESM module concatenation issue
      '*/node_modules/zustand': {
        loaders: [],
        as: '*.js',
      },
    },
  },
  webpack: (config) => {
    // Fix Zustand ESM module concatenation issue (for non-turbopack builds)
    config.module.rules.push({
      test: /node_modules\/zustand/,
      sideEffects: true,
    });
    
    // Ensure @tanstack/react-query from packages/client uses the same instance as the main app
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tanstack/react-query': require.resolve('@tanstack/react-query'),
    };
    
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
  compiler: {
    removeConsole: isProdOrTest
      ? {
          exclude: ['error', 'warn', 'info'],
        }
      : false,
  },
};

export default nextConfig;
