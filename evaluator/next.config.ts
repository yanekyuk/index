import path from "node:path";
import type { NextConfig } from "next";

const evaluatorRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  turbopack: {
    root: evaluatorRoot,
  },
  webpack: (config) => {
    config.context = evaluatorRoot;
    return config;
  },
};

export default nextConfig;
