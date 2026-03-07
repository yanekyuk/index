import path from "node:path";
import type { NextConfig } from "next";

// Frontend project root (do not use '..' — see 2eb2d092, breaks tailwindcss resolution)
const frontendRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const target = process.env.PROTOCOL_URL;
    if (!target) return [];
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
    ];

    console.log('target', target);
  },
  turbopack: {
    root: frontendRoot,
  },
  webpack: (config) => {
    config.context = frontendRoot;
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.pravatar.cc',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatar.vercel.sh',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'index.network',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'dev.index.network',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.slack-edge.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.storageapi.dev',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'indexnetwork.s3.us-east-1.amazonaws.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;