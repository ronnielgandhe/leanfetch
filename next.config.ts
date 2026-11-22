import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "x-frame-options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
