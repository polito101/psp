const steps = [
  {
    number: "01",
    gradientClass: "from-[#00d4c8] to-[#4f6ef7]",
    title: "Connect",
    description: "Set up your Finara account in minutes. Integrate via our API or no-code tools and start accepting payments immediately."
  },
  {
    number: "02",
    gradientClass: "from-[#4f6ef7] to-[#c936e8]",
    title: "Manage",
    description: "Use the real-time dashboard to track every transaction, monitor cash flow, and control your financial operations effortlessly."
  },
  {
    number: "03",
    gradientClass: "from-[#c936e8] to-[#f97316]",
    title: "Grow",
    description: "Scale with confidence. Expand to new markets and payment methods — our infrastructure handles any volume, anywhere."
  }
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="relative py-24 lg:py-32 bg-[#0c0c14] scroll-mt-20 overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 -translate-y-1/2 left-0 w-[400px] h-[400px] rounded-full bg-[#5b6ef7]/12 blur-[110px]" />
        <div className="absolute top-1/2 -translate-y-1/2 right-0 w-[350px] h-[350px] rounded-full bg-[#a020c8]/12 blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">How it works</span>
          <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance">
            Three steps to financial control
          </h2>
          <p className="mt-5 text-base text-[#8b8baa]">
            From setup to scale — Finara guides you every step of the way.
          </p>
        </div>

        <div className="mt-16 lg:mt-20 grid lg:grid-cols-3 gap-8 lg:gap-10 relative">
          {/* Connector line */}
          <div className="hidden lg:block absolute top-14 left-[calc(33.333%-1rem)] right-[calc(33.333%-1rem)] h-px bg-gradient-to-r from-[#00d4c8] via-[#c936e8] to-[#f97316] opacity-30" />

          {steps.map((step, index) => (
            <div key={index} className="relative flex flex-col">
              {/* Number badge */}
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.gradientClass} flex items-center justify-center mb-6 shrink-0`}>
                <span className="text-xl font-bold text-white">{step.number}</span>
              </div>
              <h3 className="text-2xl font-bold text-white">{step.title}</h3>
              <p className="mt-3 text-[#8b8baa] leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
