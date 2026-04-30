import Link from "next/link"
import Image from "next/image"
import { ArrowRight, ChevronDown, Instagram, Twitter, Music } from "lucide-react"

import { getMerchantBackofficeLoginUrl } from "@/lib/merchant-portal-url"

const merchantPortalLoginUrl = getMerchantBackofficeLoginUrl()


const stats = [
  { value: "Global", label: "Coverage" },
  { value: "Multi-method", label: "Payments" },
  { value: "Reliable", label: "Infrastructure" },
  { value: "Fast", label: "Integration" },
]

const socialLinks = [
  {
    icon: Instagram,
    href: "https://www.instagram.com/finara.online/",
    label: "Instagram",
    color: "hover:text-[#E4405F]",
  },
  {
    icon: Twitter,
    href: "https://x.com/FinaraOnline",
    label: "X (Twitter)",
    color: "hover:text-white",
  },
  {
    icon: Music,
    href: "https://www.tiktok.com/@finara.online",
    label: "TikTok",
    color: "hover:text-[#25F4EE]",
  },
]

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center pt-20 pb-0 overflow-hidden">
      {/* Animated SVG grid */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(79,110,247,0.2)" strokeWidth="0.8" />
            <animateTransform
              attributeName="patternTransform"
              type="translate"
              from="0 0"
              to="0 80"
              dur="8s"
              repeatCount="indefinite"
            />
          </pattern>
          <pattern id="dots" width="80" height="80" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="2" fill="rgba(0,212,200,0.3)" />
            <circle cx="80" cy="0" r="2" fill="rgba(0,212,200,0.3)" />
            <circle cx="0" cy="80" r="2" fill="rgba(0,212,200,0.3)" />
            <circle cx="80" cy="80" r="2" fill="rgba(0,212,200,0.3)" />
            <animateTransform
              attributeName="patternTransform"
              type="translate"
              from="0 0"
              to="0 80"
              dur="8s"
              repeatCount="indefinite"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>

      {/* Background radial glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 -left-20 w-[700px] h-[700px] rounded-full bg-[#5b6ef7]/18 blur-[130px]" />
        <div className="absolute top-0 right-0 w-[550px] h-[550px] rounded-full bg-[#a020c8]/22 blur-[110px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] rounded-full bg-[#00d4c8]/8 blur-[100px]" />
      </div>

      {/* Main content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 w-full py-16 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left: text content */}
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 mb-8">
              <span className="w-2 h-2 rounded-full bg-[#00d4c8] animate-pulse" />
              <span className="text-sm font-medium text-[#8b8baa]">Payment infrastructure built for businesses</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight text-white leading-[1.1] text-balance">
              Payment infrastructure for{" "}
              <span className="text-brand-gradient">modern businesses.</span>
            </h1>

            <p className="mt-6 text-base lg:text-lg text-[#8b8baa] max-w-xl leading-relaxed">
              Finara empowers businesses with a unified payment infrastructure designed for global scale. 
              Accept, process, and settle transactions seamlessly across borders.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <Link
                href={merchantPortalLoginUrl}
                className="btn-brand-gradient inline-flex items-center gap-1.5 text-xs font-semibold px-5 py-2 rounded-full"
              >
                Start accepting payments
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <div className="flex items-center gap-2">
                <Link
                  href="#features"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8b8baa] hover:text-white transition-colors border border-white/10 hover:border-white/20 px-4 py-2 rounded-full"
                >
                  Discover more
                  <ChevronDown className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="#how-it-works"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8b8baa] hover:text-white transition-colors border border-white/10 hover:border-white/20 px-4 py-2 rounded-full"
                >
                  How it works
                  <ChevronDown className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {/* Stat row — key2pay style inline counters */}
            <div className="mt-12 flex flex-wrap gap-x-8 gap-y-5">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col">
                  <span className="text-2xl font-bold text-brand-gradient">{stat.value}</span>
                  <span className="text-xs text-[#8b8baa] mt-0.5">{stat.label}</span>
                </div>
              ))}
            </div>

            {/* Social links */}
            <div className="mt-10 flex items-center gap-3">
              <span className="text-xs text-[#8b8baa] uppercase tracking-widest">Follow us:</span>
              {socialLinks.map((social) => {
                const Icon = social.icon
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={social.label}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center bg-white/6 border border-white/8 text-[#8b8baa] transition-all duration-300 hover:bg-white/10 hover:border-white/15 ${social.color}`}
                  >
                    <Icon className="w-4 h-4" />
                  </a>
                )
              })}
            </div>
          </div>

          {/* Right: hero image */}
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#4f6ef7]/20 via-[#c936e8]/10 to-[#00d4c8]/10 blur-2xl" />
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%2029%20abr%202026%2C%2014_46_24-DNE6LFRAf8cvWFRHh3oqD3YmZ9JNId.png"
              alt="Finara payment solutions — secure cards and global infrastructure"
              width={560}
              height={560}
              className="relative z-10 w-full max-w-sm lg:max-w-full rounded-2xl"
              priority
            />
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="relative z-10 flex justify-center pb-8">
        <Link href="#why-finara" aria-label="Scroll down">
          <ChevronDown className="w-6 h-6 text-white/30 animate-bounce" />
        </Link>
      </div>
    </section>
  )
}
