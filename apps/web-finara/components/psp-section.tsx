import { Settings2, ShieldCheck, ArrowLeftRight, Headphones, Globe, Zap } from "lucide-react"

const reasons = [
  {
    icon: Settings2,
    iconColor: "#00d4c8",
    title: "Easy to set up",
    description: "Intuitive interface that reduces cart abandonment and boosts conversion rates.",
  },
  {
    icon: ShieldCheck,
    iconColor: "#4f6ef7",
    title: "Secure transactions",
    description: "Advanced encryption and real-time fraud detection on every transaction.",
  },
  {
    icon: ArrowLeftRight,
    iconColor: "#c936e8",
    title: "Local payins & payouts",
    description: "Settlement across all major corridors and currencies worldwide.",
  },
  {
    icon: Headphones,
    iconColor: "#ec4899",
    title: "24/7 support",
    description: "Dedicated account manager and round-the-clock merchant support.",
  },
  {
    icon: Globe,
    iconColor: "#f97316",
    title: "180+ countries",
    description: "Global by design with local acquiring and region-specific compliance.",
  },
  {
    icon: Zap,
    iconColor: "#00d4c8",
    title: "Single API",
    description: "One powerful integration for online, in-app, POS, or in-store payments.",
  },
]

const stats = [
  { value: "2026", label: "Founded" },
  { value: "48h", label: "Onboarding" },
  { value: "180+", label: "Countries" },
  { value: "24/7", label: "Support" },
]

export function PSPSection() {
  return (
    <section id="why-finara" className="relative py-24 lg:py-32 bg-[#0c0c14] overflow-hidden scroll-mt-20">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -bottom-20 left-0 w-[500px] h-[400px] rounded-full bg-[#5b6ef7]/12 blur-[120px]" />
        <div className="absolute top-0 right-0 w-[350px] h-[350px] rounded-full bg-[#c936e8]/10 blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Why choose Finara</span>
          <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance leading-tight">
            Payments built on<br />
            <span className="text-brand-gradient">trust and technology.</span>
          </h2>
          <p className="mt-5 text-base text-[#8b8baa] leading-relaxed">
            Founded by fintech veterans, we combine deep regulatory expertise with modern engineering 
            to deliver a PSP that is as reliable as it is easy to use.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-1 p-5 rounded-2xl bg-white/4 border border-white/8 text-center"
            >
              <span className="text-2xl font-bold text-brand-gradient">{stat.value}</span>
              <span className="text-xs text-[#8b8baa]">{stat.label}</span>
            </div>
          ))}
        </div>

        {/* 6-card grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {reasons.map((reason, index) => (
            <div
              key={index}
              className="group flex flex-col gap-4 p-6 rounded-2xl bg-white/4 border border-white/8 hover:border-white/14 hover:bg-white/6 transition-all duration-300"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${reason.iconColor}18` }}
              >
                <reason.icon className="w-5 h-5" style={{ color: reason.iconColor }} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{reason.title}</h3>
                <p className="mt-1.5 text-sm text-[#8b8baa] leading-relaxed">{reason.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
