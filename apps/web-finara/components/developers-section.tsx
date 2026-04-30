import Link from "next/link"
import { Code2, Webhook, Terminal, BookOpen, ArrowRight } from "lucide-react"

const devFeatures = [
  {
    icon: Code2,
    iconColor: "#00d4c8",
    title: "RESTful API",
    description:
      "Clean, predictable REST endpoints with JSON payloads. Follows standard HTTP conventions so your team can integrate in hours, not days.",
    tag: "v2.0",
  },
  {
    icon: Webhook,
    iconColor: "#4f6ef7",
    title: "Webhooks",
    description:
      "Real-time event notifications for payments, refunds, disputes, and settlement changes — with automatic retries and delivery guarantees.",
    tag: "Real-time",
  },
  {
    icon: Terminal,
    iconColor: "#c936e8",
    title: "Sandbox environment",
    description:
      "A full-featured test environment that mirrors production exactly. Simulate edge cases, card declines, and 3DS flows safely.",
    tag: "Test ready",
  },
  {
    icon: BookOpen,
    iconColor: "#f97316",
    title: "SDKs & libraries",
    description:
      "Official SDKs for Node.js, Python, PHP, Ruby, and Java. Community libraries for Go, .NET, and more maintained by our developer community.",
    tag: "Multi-language",
  },
]

const codeSnippet = `// Initialize Finara client
import Finara from '@finara/node'

const client = new Finara({
  apiKey: process.env.FINARA_API_KEY,
  environment: 'production',
})

// Create a payment intent
const intent = await client.payments.create({
  amount: 1000,       // amount in cents
  currency: 'USD',
  description: 'Order #1042',
  metadata: { orderId: '1042' },
})

console.log(intent.id) // pay_...`

export function DevelopersSection() {
  return (
    <section id="developers" className="relative py-24 lg:py-32 bg-[#0c0c14] scroll-mt-20 overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[400px] rounded-full bg-[#4f6ef7]/14 blur-[130px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[350px] rounded-full bg-[#00d4c8]/8 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="grid lg:grid-cols-2 gap-12 items-start mb-16">
          <div>
            <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Developers</span>
            <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance leading-tight">
              An API developers<br />
              <span className="text-brand-gradient">actually love.</span>
            </h2>
          </div>
          <div className="lg:pt-14 flex flex-col gap-4">
            <p className="text-base text-[#8b8baa] leading-relaxed">
              Finara was designed API-first. Every feature available in the dashboard is also
              available through the API — giving you complete programmatic control over your
              payment stack.
            </p>
            <div className="flex items-center gap-4">
              <Link
                href="#help"
                className="btn-brand-gradient inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-full"
              >
                Read the docs
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="#contact"
                className="text-sm font-medium text-[#8b8baa] hover:text-white transition-colors"
              >
                Talk to an engineer
              </Link>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Feature cards */}
          <div className="grid sm:grid-cols-2 gap-4">
            {devFeatures.map((feat) => (
              <div
                key={feat.title}
                className="flex flex-col gap-3 p-6 rounded-2xl bg-white/4 border border-white/8 hover:border-white/14 hover:bg-white/6 transition-all duration-300"
              >
                <div className="flex items-center justify-between">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${feat.iconColor}18` }}
                  >
                    <feat.icon className="w-5 h-5" style={{ color: feat.iconColor }} />
                  </div>
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      color: feat.iconColor,
                      backgroundColor: `${feat.iconColor}15`,
                    }}
                  >
                    {feat.tag}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white">{feat.title}</h3>
                <p className="text-xs text-[#8b8baa] leading-relaxed">{feat.description}</p>
              </div>
            ))}
          </div>

          {/* Code snippet */}
          <div className="rounded-2xl bg-[#0a0a12] border border-white/10 overflow-hidden">
            {/* Fake terminal bar */}
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/8 bg-white/3">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" />
              <span className="ml-4 text-xs text-[#8b8baa] font-mono">finara-quickstart.js</span>
            </div>
            <pre className="p-6 text-xs font-mono text-[#8b8baa] leading-relaxed overflow-x-auto">
              <code>
                {codeSnippet.split("\n").map((line, i) => {
                  // Colour comments teal, strings warm, keywords purple
                  if (line.trim().startsWith("//")) {
                    return (
                      <span key={i} className="text-[#00d4c8]/60">
                        {line}{"\n"}
                      </span>
                    )
                  }
                  if (line.includes("import") || line.includes("const") || line.includes("await")) {
                    return (
                      <span key={i} className="text-[#c936e8]/80">
                        {line}{"\n"}
                      </span>
                    )
                  }
                  if (line.includes("'") || line.includes("`")) {
                    return (
                      <span key={i} className="text-[#f97316]/80">
                        {line}{"\n"}
                      </span>
                    )
                  }
                  return <span key={i}>{line}{"\n"}</span>
                })}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  )
}
