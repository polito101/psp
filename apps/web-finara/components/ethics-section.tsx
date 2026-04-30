import Link from "next/link"
import { ShieldAlert, Eye, Lock, AlertTriangle } from "lucide-react"

const commitments = [
  {
    icon: Eye,
    iconColor: "#00d4c8",
    title: "Transparency",
    description:
      "We disclose our policies, fees, and operational practices in plain language. No hidden charges, no fine print designed to mislead.",
  },
  {
    icon: ShieldAlert,
    iconColor: "#4f6ef7",
    title: "Anti-corruption",
    description:
      "Zero tolerance for bribery, kickbacks, or conflicts of interest — across our team, partners, and supply chain at every level.",
  },
  {
    icon: Lock,
    iconColor: "#c936e8",
    title: "Data privacy",
    description:
      "We collect only what is necessary and never sell personal data. GDPR and CCPA compliant by design, not by checkbox.",
  },
  {
    icon: AlertTriangle,
    iconColor: "#f97316",
    title: "Secure reporting",
    description:
      "Anyone — employee, partner, or merchant — can report concerns securely and anonymously through our Compliance Hub.",
  },
]

export function EthicsSection() {
  return (
    <section id="ethics" className="relative py-24 lg:py-32 bg-[#0c0c14] scroll-mt-20 overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-0 w-[500px] h-[400px] rounded-full bg-[#5b6ef7]/12 blur-[130px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[350px] rounded-full bg-[#a020c8]/10 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-2 gap-12 items-start mb-16">
          <div>
            <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Compliance Hub</span>
            <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance leading-tight">
              Doing business<br />
              <span className="text-brand-gradient">the right way.</span>
            </h2>
          </div>
          <div className="lg:pt-14">
            <p className="text-base text-[#8b8baa] leading-relaxed">
              At Finara, ethical conduct is not a policy document — it is how we operate every day.
              Our Compliance Hub ensures every stakeholder has a secure, confidential channel 
              to report concerns and maintain the highest standards of integrity.
            </p>
          </div>
        </div>

        {/* Commitment cards */}
        <div className="grid sm:grid-cols-2 gap-5">
          {commitments.map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-5 p-7 rounded-2xl bg-white/4 border border-white/8 hover:border-white/14 hover:bg-white/6 transition-all duration-300"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: `${item.iconColor}18` }}
              >
                <item.icon className="w-5 h-5" style={{ color: item.iconColor }} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-[#8b8baa] leading-relaxed">{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Report callout */}
        <div className="mt-12 p-8 rounded-2xl bg-white/4 border border-white/10 flex flex-col sm:flex-row items-start sm:items-center gap-6 justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Report a concern confidentially</h3>
            <p className="mt-1 text-sm text-[#8b8baa]">
              All reports are reviewed by our independent Ethics Committee. Your identity is protected.
            </p>
          </div>
          <Link
            href="mailto:ethics@finara.online"
            className="btn-brand-gradient inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-full shrink-0"
          >
            Submit a report
          </Link>
        </div>
      </div>
    </section>
  )
}
