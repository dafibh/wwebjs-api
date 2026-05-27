import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Nested inside the fork repo (which has its own lockfile); pin tracing here.
  outputFileTracingRoot: import.meta.dirname,
  // The control plane has its own toolchain; don't inherit the fork's
  // (non-TypeScript) root ESLint config during builds.
  eslint: { ignoreDuringBuilds: true }
}

export default nextConfig
