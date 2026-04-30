import Link from "next/link"
import Image from "next/image"
import { Instagram, Twitter, Music } from "lucide-react"

const footerLinks = {
  solutions: [
    { label: "Payment Methods", href: "#" },
    { label: "Converged Commerce", href: "#features" },
    { label: "Single API", href: "#how-it-works" },
    { label: "Global Transfers", href: "#features" },
  ],
  developers: [
    { label: "API Reference", href: "/api" },
    { label: "Guides", href: "/guides" },
    { label: "Getting Started", href: "/docs" },
    { label: "Sandbox", href: "/sandbox" },
  ],
  support: [
    { label: "Contact us", href: "mailto:hello@finara.online" },
    { label: "Help Center", href: "/help" },
    { label: "Terms & Conditions", href: "/terms" },
    { label: "Privacy Policy", href: "/privacy" },
  ],
}

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

export function Footer() {
  return (
    <footer className="bg-[#09090f] border-t border-white/6">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">

        {/* Main footer grid */}
        <div className="py-16 grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand col */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-5">
              <Image
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%2028%20abr%202026%2C%2016_28_32-1pbUx2v8hkFkBiOqD6sHJXZNpBUfqL.png"
                alt="Finara app icon"
                width={36}
                height={36}
                className="h-9 w-9 rounded-xl object-cover shrink-0"
              />
              <span className="text-lg font-bold tracking-tight text-brand-gradient">Finara</span>
            </Link>
            <p className="text-sm text-[#8b8baa] leading-relaxed max-w-xs">
              Next-generation payment infrastructure for businesses that need to grow without boundaries.
            </p>
            <p className="mt-4 text-sm font-semibold text-brand-gradient">finara.online</p>
            
            {/* Contact emails */}
            <div className="mt-5 flex flex-col gap-1.5">
              <a href="mailto:support@finara.online" className="text-sm text-[#8b8baa] hover:text-white transition-colors">
                support@finara.online
              </a>
              <a href="mailto:management@finara.online" className="text-sm text-[#8b8baa] hover:text-white transition-colors">
                management@finara.online
              </a>
            </div>

            {/* Social links */}
            <div className="mt-6 flex items-center gap-3">
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

          {/* Solutions */}
          <div>
            <h4 className="text-xs font-semibold text-white uppercase tracking-widest">Solutions</h4>
            <ul className="mt-4 flex flex-col gap-3">
              {footerLinks.solutions.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-[#8b8baa] hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Developers */}
          <div>
            <h4 className="text-xs font-semibold text-white uppercase tracking-widest">Developers</h4>
            <ul className="mt-4 flex flex-col gap-3">
              {footerLinks.developers.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-[#8b8baa] hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-xs font-semibold text-white uppercase tracking-widest">Support</h4>
            <ul className="mt-4 flex flex-col gap-3">
              {footerLinks.support.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm text-[#8b8baa] hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="py-5 border-t border-white/6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[#8b8baa]">
            &copy; {new Date().getFullYear()} Finara · All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/terms" className="text-xs text-[#8b8baa] hover:text-white transition-colors">Terms</Link>
            <Link href="/privacy" className="text-xs text-[#8b8baa] hover:text-white transition-colors">Privacy</Link>
            <Link href="/compliance" className="text-xs text-[#8b8baa] hover:text-white transition-colors">Compliance</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
