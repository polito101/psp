import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  /** Monorepo: fija el root de Turbopack al directorio de esta app (evita lockfile de la raíz). */
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
