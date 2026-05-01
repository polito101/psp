"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Menu, X } from "lucide-react"
import { getMerchantBackofficeLoginUrl } from "@/lib/merchant-portal-url"

const merchantPortalLoginUrl = getMerchantBackofficeLoginUrl()

const navLinks = [
  { href: "#who-is-finara-for", label: "For Business" },
  { href: "#security", label: "Security" },
  { href: "#platform", label: "Platform" },
  { href: "#payment-methods", label: "Payments" },
  { href: "#why-finara", label: "Why Finara?" },
  { href: "#ethics", label: "Compliance" },
  { href: "#developers", label: "Developers" },
  { href: "#contact", label: "Contact" },
]

export function Header() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#09090f]/85 backdrop-blur-md border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%2028%20abr%202026%2C%2016_28_32-1pbUx2v8hkFkBiOqD6sHJXZNpBUfqL.png"
              alt="Finara app icon"
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl object-cover"
              priority
            />
            <Image
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Adobe%20Express%20-%20file-aZ56aJI4c0pJpbBNcYPFKYWmCFPE0W.png"
              alt="Finara"
              width={320}
              height={100}
              className="h-20 w-auto logo-lighten"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-[#8b8baa] hover:text-white transition-colors duration-200 whitespace-nowrap"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden lg:flex items-center gap-3">
            <Link
              href={merchantPortalLoginUrl}
              className="text-sm font-medium text-[#8b8baa] hover:text-white px-4 py-2 transition-colors duration-200"
            >
              Log in
            </Link>
            <Link
              href="/merchant-signup"
              className="btn-brand-gradient text-sm font-semibold px-5 py-2 rounded-full transition-opacity duration-200"
            >
              Create account
            </Link>
          </div>

          {/* Mobile menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild className="lg:hidden">
              <button
                className="p-2 text-[#8b8baa] hover:text-white transition-colors"
                aria-label="Toggle menu"
              >
                {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 bg-[#111118] border-white/10">
              <nav className="flex flex-col gap-6 mt-10">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-lg font-medium text-white/80 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="flex flex-col gap-3 mt-4 pt-6 border-t border-white/10">
                  <Link
                    href={merchantPortalLoginUrl}
                    className="text-center py-2 px-4 rounded-full border border-white/20 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                  >
                    Log in
                  </Link>
                  <Link
                    href="/merchant-signup"
                    className="btn-brand-gradient text-center py-2 px-4 rounded-full text-sm font-semibold"
                  >
                    Create account
                  </Link>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
