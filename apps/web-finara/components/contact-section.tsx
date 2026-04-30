import Link from "next/link"
import { HeadphonesIcon, BriefcaseBusiness, Clock } from "lucide-react"

const contacts = [
  {
    icon: HeadphonesIcon,
    iconColor: "#00d4c8",
    label: "Customer Support",
    description: "For technical issues, account help, and general questions.",
    email: "support@finara.online",
  },
  {
    icon: BriefcaseBusiness,
    iconColor: "#c936e8",
    label: "Business & Management",
    description: "For partnerships, merchant onboarding, and commercial inquiries.",
    email: "management@finara.online",
  },
]



export function ContactSection() {
  return (
    <section id="contact" className="relative py-24 lg:py-32 scroll-mt-20 overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[450px] h-[400px] rounded-full bg-[#a020c8]/12 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[350px] rounded-full bg-[#5b6ef7]/10 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 lg:px-8">

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Contact</span>
          <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance">
            Get in touch
          </h2>
          <p className="mt-5 text-base text-[#8b8baa] leading-relaxed">
            We&apos;re here to help you with anything you need. Reach out to the right team and we&apos;ll get back to you promptly.
          </p>
        </div>

        {/* Email cards */}
        <div className="grid sm:grid-cols-2 gap-5 mb-10">
          {contacts.map((contact) => (
            <Link
              key={contact.email}
              href={`mailto:${contact.email}`}
              className="group flex flex-col gap-5 p-8 rounded-2xl bg-white/4 border border-white/8 hover:border-white/16 hover:bg-white/6 transition-all duration-300"
            >
              {/* Icon */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${contact.iconColor}18` }}
              >
                <contact.icon className="w-6 h-6" style={{ color: contact.iconColor }} />
              </div>

              {/* Label + description */}
              <div className="flex-1">
                <div className="text-xs font-semibold text-[#8b8baa] uppercase tracking-widest mb-1.5">
                  {contact.label}
                </div>
                <p className="text-sm text-[#8b8baa] leading-relaxed">
                  {contact.description}
                </p>
              </div>

              {/* Email address */}
              <div className="pt-4 border-t border-white/8">
                <span className="text-base font-semibold text-white group-hover:text-brand-gradient transition-colors duration-300">
                  {contact.email}
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* Support availability */}
        <div className="flex justify-center">
          <div className="flex items-center gap-4 px-6 py-5 rounded-2xl bg-white/4 border border-white/8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#00d4c8]/12">
              <Clock className="w-5 h-5 text-[#00d4c8]" />
            </div>
            <div>
              <div className="text-xs text-[#8b8baa] uppercase tracking-widest">Availability</div>
              <div className="mt-0.5 text-sm font-semibold text-white">24 / 7 / 365</div>
            </div>
          </div>
        </div>

      </div>
    </section>
  )
}
