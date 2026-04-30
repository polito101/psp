import { CreditCard, Globe, ArrowLeftRight, Zap, Code2, Users } from "lucide-react"
import Link from "next/link"

const solutions = [
  {
    icon: CreditCard,
    iconColor: "#00d4c8",
    title: "Payment Methods",
    description: "Accept cards, bank transfers, wallets, and local methods. Over 100 options in a single integration.",
    href: "#",
  },
  {
    icon: Globe,
    iconColor: "#4f6ef7",
    title: "Converged Commerce",
    description: "Unified payments for online, in-app, POS, and in-store. One platform across all channels.",
    href: "#",
  },
  {
    icon: Code2,
    iconColor: "#c936e8",
    title: "Single API",
    description: "One integration for all payment flows. Bank-grade security with complete flexibility.",
    href: "#",
  },
  {
    icon: ArrowLeftRight,
    iconColor: "#ec4899",
    title: "Global Transfers",
    description: "SEPA for Europe, SWIFT for worldwide. Fast settlement across major corridors and currencies.",
    href: "#",
  },
  {
    icon: Zap,
    iconColor: "#f97316",
    title: "Fast Onboarding",
    description: "Go live in 48 hours. Clear pricing, fast settlements, and straightforward terms.",
    href: "#",
  },
  {
    icon: Users,
    iconColor: "#00d4c8",
    title: "Dedicated Support",
    description: "24/7 merchant support with a dedicated account manager who understands your business.",
    href: "#",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="relative py-24 lg:py-32 bg-[#0c0c14] scroll-mt-20 overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[400px] rounded-full bg-[#c936e8]/10 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[350px] rounded-full bg-[#5b6ef7]/10 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-end mb-16 lg:mb-20">
          <div>
            <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Solutions</span>
            <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance leading-tight">
              Everything you need to<br />
              <span className="text-brand-gradient">accept payments globally.</span>
            </h2>
          </div>
          <p className="text-base text-[#8b8baa] leading-relaxed lg:pb-2">
            One integration. Multiple payment methods. Global coverage. 
            Built for businesses that need reliable, scalable payment infrastructure.
          </p>
        </div>

        {/* Solutions grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {solutions.map((solution, index) => (
            <div
              key={index}
              className="group flex flex-col gap-4 p-7 rounded-2xl bg-white/4 border border-white/8 hover:border-white/14 hover:bg-white/6 transition-all duration-300"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${solution.iconColor}18` }}
              >
                <solution.icon className="w-5 h-5" style={{ color: solution.iconColor }} />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white">{solution.title}</h3>
                <p className="mt-2 text-sm text-[#8b8baa] leading-relaxed">{solution.description}</p>
              </div>
              <Link
                href={solution.href}
                className="text-xs font-semibold text-brand-gradient hover:opacity-80 transition-opacity"
              >
                Learn more &rarr;
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

