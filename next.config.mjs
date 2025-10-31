import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Silence the Turbopack root inference warning on Vercel/local
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
