"use client"

import { useEffect, useRef, useState } from "react"
import { ShieldCheck, Lock, Award, CheckCircle2 } from "lucide-react"

const counters = [
  { target: 100, suffix: "+", label: "Payment methods", color: "#00d4c8" },
  { target: 99.99, suffix: "%", decimals: 2, label: "Continuous reliability", color: "#4f6ef7" },
  { target: 4.9, suffix: "", decimals: 1, label: "User rating", color: "#ec4899" },
  { target: 180, suffix: "+", label: "Countries", color: "#f97316" },
]

const certifications = [
  { icon: ShieldCheck, color: "#00d4c8", label: "PCI DSS Level 1" },
  { icon: Lock, color: "#4f6ef7", label: "256-bit SSL encryption" },
  { icon: Award, color: "#c936e8", label: "FINTRAC licensed MSB" },
  { icon: CheckCircle2, color: "#f97316", label: "DIEZA authorized PSP" },
]

const testimonials = [
  {
    quote: "Finara transformed how we handle payments. The speed, security, and simplicity are genuinely unmatched in the market.",
    author: "Sarah Chen",
    initials: "SC",
    role: "CFO, TechScale Inc.",
    gradientFrom: "#00d4c8",
    gradientTo: "#4f6ef7",
  },
  {
    quote: "Finally a payment platform that feels modern and actually works the way you expect. Onboarding took under 48 hours.",
    author: "Marcus Rodriguez",
    initials: "MR",
    role: "Founder, Elevate Commerce",
    gradientFrom: "#c936e8",
    gradientTo: "#f97316",
  },
]

function useCounter(target: number, decimals = 0, duration = 2000) {
  const [value, setValue] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const start = performance.now()
          const step = (now: number) => {
            const elapsed = now - start
            const progress = Math.min(elapsed / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            setValue(parseFloat((eased * target).toFixed(decimals)))
            if (progress < 1) requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [target, decimals, duration])

  return { value, ref }
}

function CounterItem({ target, suffix, decimals = 0, label, color }: {
  target: number; suffix: string; decimals?: number; label: string; color: string
}) {
  const { value, ref } = useCounter(target, decimals)
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 p-6 lg:p-8 rounded-2xl bg-white/4 border border-white/8 text-center">
      <div className="text-3xl lg:text-4xl font-bold" style={{ color }}>
        {decimals > 0 ? value.toFixed(decimals) : Math.floor(value)}{suffix}
      </div>
      <div className="text-sm text-[#8b8baa]">{label}</div>
    </div>
  )
}

export function TrustSection() {
  return (
    <section id="security" className="relative py-24 lg:py-32 scroll-mt-20 overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-20 right-0 w-[450px] h-[450px] rounded-full bg-[#a020c8]/14 blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[350px] rounded-full bg-[#5b6ef7]/10 blur-[110px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Trust & Security</span>
          <h2 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance">
            Get paid faster and<br />
            <span className="text-brand-gradient">more securely.</span>
          </h2>
          <p className="mt-5 text-base text-[#8b8baa]">
            Accelerate your cash flow while ensuring top-tier security with our cutting-edge payment infrastructure.
          </p>
        </div>

        {/* Animated counters */}
        <div className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {counters.map((counter) => (
            <CounterItem key={counter.label} {...counter} />
          ))}
        </div>

        {/* Certification badges */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {certifications.map((cert) => (
            <div
              key={cert.label}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/8 bg-white/4"
            >
              <cert.icon className="w-4 h-4 shrink-0" style={{ color: cert.color }} />
              <span className="text-xs font-medium text-[#8b8baa]">{cert.label}</span>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="mt-16 lg:mt-20 grid md:grid-cols-2 gap-6">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="p-8 lg:p-10 rounded-2xl bg-white/4 border border-white/8"
            >
              <div className="flex gap-1 mb-5">
                {[...Array(5)].map((_, i) => (
                  <span key={i} className="text-[#f97316] text-sm">&#9733;</span>
                ))}
              </div>
              <blockquote className="text-base lg:text-lg text-white/90 leading-relaxed">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="mt-6 flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: `linear-gradient(135deg, ${testimonial.gradientFrom}, ${testimonial.gradientTo})` }}
                >
                  <span className="text-sm font-bold text-white">{testimonial.initials}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{testimonial.author}</div>
                  <div className="text-xs text-[#8b8baa]">{testimonial.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
