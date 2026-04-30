import { ShoppingCart, Cloud, Store, Landmark } from "lucide-react"

const audiences = [
  {
    icon: ShoppingCart,
    title: "E-commerce",
    description: "Online stores and retail platforms looking for seamless checkout experiences.",
    color: "#00d4c8",
  },
  {
    icon: Cloud,
    title: "SaaS",
    description: "Subscription-based software companies needing recurring billing solutions.",
    color: "#5b6ef7",
  },
  {
    icon: Store,
    title: "Marketplaces",
    description: "Multi-vendor platforms requiring split payments and escrow capabilities.",
    color: "#c936e8",
  },
  {
    icon: Landmark,
    title: "Fintech",
    description: "Financial technology companies building the next generation of payment products.",
    color: "#f97316",
  },
]

export function B2BSection() {
  return (
    <section id="who-is-finara-for" className="relative py-24 lg:py-32 overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-[#5b6ef7]/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-[#c936e8]/8 blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left: Text content */}
          <div>
            <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Built for businesses</span>
            <h2 className="mt-4 text-3xl lg:text-4xl font-bold text-white tracking-tight text-balance">
              Who is Finara for?
            </h2>
            <p className="mt-4 text-base text-[#8b8baa] leading-relaxed max-w-lg">
              Finara is payment infrastructure designed exclusively for businesses. 
              From startups to enterprises, we provide the tools to accept, process, 
              and manage payments at any scale.
            </p>
            
            <div className="mt-8 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#00d4c8]" />
                <span className="text-sm text-white">For online companies scaling globally</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#5b6ef7]" />
                <span className="text-sm text-white">For platforms needing flexible payment routing</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#c936e8]" />
                <span className="text-sm text-white">For teams that demand enterprise-grade reliability</span>
              </div>
            </div>
          </div>

          {/* Right: Audience cards */}
          <div className="grid sm:grid-cols-2 gap-4">
            {audiences.map((audience) => (
              <div
                key={audience.title}
                className="group relative p-6 rounded-2xl bg-white/[0.03] border border-white/8 hover:border-white/15 transition-all duration-300"
              >
                <div 
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${audience.color}15` }}
                >
                  <audience.icon className="w-5 h-5" style={{ color: audience.color }} />
                </div>
                <h3 className="text-base font-semibold text-white mb-1.5">{audience.title}</h3>
                <p className="text-sm text-[#8b8baa] leading-relaxed">{audience.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
