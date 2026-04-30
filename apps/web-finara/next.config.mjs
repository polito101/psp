import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hebbkx1anhila5yf.public.blob.vercel-storage.com',
        pathname: '/**',
      },
    ],
  },
  /** Monorepo: fija el root de Turbopack al directorio de esta app (evita lockfile de la raíz). */
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
