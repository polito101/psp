"use client"

import { useState } from "react"
import { CreditCard, Wallet, Building2, Globe, ArrowLeftRight, Smartphone } from "lucide-react"

const methods = [
  {
    icon: CreditCard,
    iconColor: "#00d4c8",
    title: "Card payments",
    description: "Visa, Mastercard, Amex, UnionPay and more — with 3DS2 and instant authorization.",
    tag: "Most popular",
    tagColor: "#00d4c8",
  },
  {
    icon: Wallet,
    iconColor: "#4f6ef7",
    title: "Digital wallets",
    description: "Apple Pay, Google Pay, PayPal and 40+ digital wallets accepted globally.",
    tag: "Growing fast",
    tagColor: "#4f6ef7",
  },
  {
    icon: Building2,
    iconColor: "#c936e8",
    title: "Bank transfers",
    description: "SEPA, SWIFT, ACH and local bank rails for reliable B2B and B2C settlements.",
    tag: "Enterprise",
    tagColor: "#c936e8",
  },
  {
    icon: Globe,
    iconColor: "#ec4899",
    title: "Local payment methods",
    description: "Boleto, iDEAL, PIX, Klarna, OXXO and 80+ local methods for every market.",
    tag: "Localized",
    tagColor: "#ec4899",
  },
  {
    icon: ArrowLeftRight,
    iconColor: "#f97316",
    title: "Global payouts",
    description: "Send funds to 180+ countries via SEPA, SWIFT, and local settlement rails.",
    tag: "Fast settlement",
    tagColor: "#f97316",
  },
  {
    icon: Smartphone,
    iconColor: "#00d4c8",
    title: "In-app & POS",
    description: "Unified commerce — the same API powers in-store terminals and mobile checkouts.",
    tag: "Omnichannel",
    tagColor: "#00d4c8",
  },
]

export function PaymentMethodsSection() {
  const [active, setActive] = useState(0)

  return (
    <section id="payment-methods" className="relative py-24 lg:py-32 overflow-hidden scroll-mt-20">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-0 w-[450px] h-[400px] rounded-full bg-[#5b6ef7]/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[350px] rounded-full bg-[#c936e8]/10 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Payment methods</span>
          <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance">
            A whole world of<br />
            <span className="text-brand-gradient">payment methods.</span>
          </h2>
          <p className="mt-5 text-base text-[#8b8baa]">
            Start accepting payments now — 100+ methods, one integration.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {methods.map((method, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActive(index)}
              className={`group text-left flex flex-col gap-4 p-7 rounded-2xl border transition-all duration-300 ${
                active === index
                  ? "bg-white/8 border-white/20 shadow-lg"
                  : "bg-white/4 border-white/8 hover:bg-white/6 hover:border-white/14"
              }`}
            >
              <div className="flex items-start justify-between">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${method.iconColor}18` }}
                >
                  <method.icon className="w-5 h-5" style={{ color: method.iconColor }} />
                </div>
                <span
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-full border"
                  style={{
                    color: method.tagColor,
                    borderColor: `${method.tagColor}30`,
                    backgroundColor: `${method.tagColor}10`,
                  }}
                >
                  {method.tag}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{method.title}</h3>
                <p className="mt-2 text-sm text-[#8b8baa] leading-relaxed">{method.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
