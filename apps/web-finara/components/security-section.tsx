import { Shield, Lock, UserCheck, Server } from "lucide-react"

const securityFeatures = [
  {
    icon: Shield,
    title: "PCI DSS Compliant",
    description: "Level 1 PCI DSS certified infrastructure ensuring the highest standards of payment data security.",
  },
  {
    icon: Lock,
    title: "End-to-End Encryption",
    description: "256-bit AES encryption protects all data in transit and at rest across our entire platform.",
  },
  {
    icon: UserCheck,
    title: "KYC / AML Procedures",
    description: "Comprehensive identity verification and anti-money laundering protocols for regulatory compliance.",
  },
  {
    icon: Server,
    title: "99.99% Uptime SLA",
    description: "Enterprise-grade infrastructure with redundant systems and real-time monitoring worldwide.",
  },
]

export function SecuritySection() {
  return (
    <section id="security" className="relative py-24 lg:py-32 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[#00d4c8]/8 blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Security & Compliance</span>
          <h2 className="mt-4 text-3xl lg:text-4xl font-bold text-white tracking-tight text-balance">
            Built on trust. Secured by design.
          </h2>
          <p className="mt-4 text-base text-[#8b8baa] leading-relaxed">
            Enterprise-grade security infrastructure that meets the highest regulatory standards, 
            so you can focus on growing your business.
          </p>
        </div>

        {/* Security grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {securityFeatures.map((feature) => (
            <div
              key={feature.title}
              className="group relative p-6 rounded-2xl bg-white/[0.03] border border-white/8 hover:border-[#00d4c8]/30 transition-all duration-300"
            >
              {/* Icon */}
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#00d4c8]/10 mb-5">
                <feature.icon className="w-6 h-6 text-[#00d4c8]" />
              </div>
              
              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-[#8b8baa] leading-relaxed">{feature.description}</p>

              {/* Hover glow effect */}
              <div className="absolute inset-0 rounded-2xl bg-[#00d4c8]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            </div>
          ))}
        </div>

        {/* Trust badges row */}
        <div className="mt-12 flex flex-wrap justify-center items-center gap-8 pt-8 border-t border-white/6">
          <div className="flex items-center gap-2 text-sm text-[#8b8baa]">
            <Shield className="w-4 h-4 text-[#00d4c8]" />
            <span>SOC 2 Type II</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#8b8baa]">
            <Lock className="w-4 h-4 text-[#5b6ef7]" />
            <span>ISO 27001</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#8b8baa]">
            <Shield className="w-4 h-4 text-[#c936e8]" />
            <span>GDPR Compliant</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-[#8b8baa]">
            <Server className="w-4 h-4 text-[#f97316]" />
            <span>Multi-region infrastructure</span>
          </div>
        </div>
      </div>
    </section>
  )
}
