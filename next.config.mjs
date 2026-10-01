/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["web-push", "pg"],
  },
};

export default nextConfig;
