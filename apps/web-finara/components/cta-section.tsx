import { ArrowRight } from "lucide-react"
import Link from "next/link"
import Image from "next/image"

import { getMerchantBackofficeLoginUrl } from "@/lib/merchant-portal-url"

const merchantPortalLoginUrl = getMerchantBackofficeLoginUrl()

export function CTASection() {
  return (
    <section className="py-24 lg:py-32 bg-[#0c0c14]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="relative rounded-3xl overflow-hidden">
          {/* Gradient background layer */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#4f6ef7]/30 via-[#c936e8]/20 to-[#f97316]/20" />
          {/* Radial glow */}
          <div className="absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full bg-[#4f6ef7]/15 blur-[100px]" />
          <div className="absolute -bottom-20 -left-20 w-[400px] h-[400px] rounded-full bg-[#00d4c8]/10 blur-[80px]" />

          <div className="relative z-10 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center p-10 lg:p-16 border border-white/10 rounded-3xl">
            {/* Text */}
            <div>
              <h2 className="text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance leading-tight">
                Payments, reimagined.
                <br />
                <span className="text-brand-gradient">Start today.</span>
              </h2>
              <p className="mt-5 text-base text-[#8b8baa] max-w-md leading-relaxed">
                Join forward-thinking businesses already using Finara to power their payments,
                expand globally, and scale with confidence.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <Link
                  href={merchantPortalLoginUrl}
                  className="btn-brand-gradient inline-flex items-center gap-2 text-base font-semibold px-8 py-3.5 rounded-full"
                >
                  Start processing payments
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="mailto:hello@finara.online"
                  className="inline-flex items-center gap-2 text-base font-medium text-[#8b8baa] hover:text-white transition-colors border border-white/15 px-8 py-3.5 rounded-full"
                >
                  Talk to sales
                </Link>
              </div>
            </div>

            {/* Right: app icon */}
            <div className="flex justify-center lg:justify-end">
              <Image
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%2028%20abr%202026%2C%2016_28_32-pHcQKVrkX86IOdwJ64qNjzVhUFIjNt.png"
                alt="Finara app icon"
                width={220}
                height={220}
                className="w-36 lg:w-52 rounded-[2.5rem] shadow-2xl shadow-[#4f6ef7]/30"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
