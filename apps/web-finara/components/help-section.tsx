import Link from "next/link"
import { BookOpen, MessageCircle, FileText, Video, ChevronRight } from "lucide-react"

const helpCategories = [
  {
    icon: BookOpen,
    iconColor: "#00d4c8",
    title: "Getting Started",
    description: "Step-by-step guides to integrate, onboard, and start accepting payments in under 48 hours.",
    links: ["Quick start guide", "Account setup", "First integration"],
  },
  {
    icon: FileText,
    iconColor: "#4f6ef7",
    title: "API Documentation",
    description: "Full reference for every endpoint, webhook, and data model in the Finara API.",
    links: ["API reference", "Authentication", "Webhooks"],
  },
  {
    icon: MessageCircle,
    iconColor: "#c936e8",
    title: "FAQs",
    description: "Answers to the most common questions from merchants and developers.",
    links: ["Payment methods", "Settlements", "Refunds & disputes"],
  },
  {
    icon: Video,
    iconColor: "#f97316",
    title: "Video Guides",
    description: "Watch short tutorials covering dashboard setup, reconciliation, and fraud tools.",
    links: ["Dashboard tour", "Fraud prevention", "Analytics setup"],
  },
]

export function HelpSection() {
  return (
    <section id="help" className="relative py-24 lg:py-32 scroll-mt-20 overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[450px] h-[400px] rounded-full bg-[#4f6ef7]/12 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] rounded-full bg-[#c936e8]/8 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Help Center</span>
          <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance">
            Everything you need<br />
            <span className="text-brand-gradient">to succeed.</span>
          </h2>
          <p className="mt-5 text-base text-[#8b8baa]">
            Find guides, documentation, and support to get the most out of Finara.
          </p>
        </div>

        {/* Category cards */}
        <div className="grid sm:grid-cols-2 gap-5">
          {helpCategories.map((cat) => (
            <div
              key={cat.title}
              className="flex flex-col gap-5 p-7 rounded-2xl bg-white/4 border border-white/8 hover:border-white/14 hover:bg-white/6 transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${cat.iconColor}18` }}
                >
                  <cat.icon className="w-5 h-5" style={{ color: cat.iconColor }} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">{cat.title}</h3>
                  <p className="mt-1.5 text-sm text-[#8b8baa] leading-relaxed">{cat.description}</p>
                </div>
              </div>
              <ul className="flex flex-col gap-2 pl-[60px]">
                {cat.links.map((link) => (
                  <li key={link}>
                    <Link
                      href="#help"
                      className="inline-flex items-center gap-1.5 text-sm text-[#8b8baa] hover:text-white transition-colors group"
                    >
                      <ChevronRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/60 transition-colors" />
                      {link}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <p className="text-sm text-[#8b8baa]">
            Can&apos;t find what you&apos;re looking for?{" "}
            <Link href="#contact" className="text-brand-gradient font-semibold hover:opacity-80 transition-opacity">
              Contact support &rarr;
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}
