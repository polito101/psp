import type { Metadata } from "next"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { MerchantSignupForm } from "@/components/merchant-signup-form"

export const metadata: Metadata = {
  title: "Merchant signup | Finara",
  description: "Solicita acceso como comercio y recibe el enlace de onboarding por email.",
}

export default function MerchantSignupPage() {
  return (
    <main className="min-h-screen">
      <Header />
      <section className="relative pt-28 pb-24 lg:pt-36 lg:pb-32 scroll-mt-20 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-0 right-0 w-[480px] h-[420px] rounded-full bg-[#a020c8]/14 blur-[120px]" />
          <div className="absolute bottom-0 left-0 w-[420px] h-[380px] rounded-full bg-[#5b6ef7]/12 blur-[110px]" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">
              Merchants
            </span>
            <h1 className="mt-4 text-3xl lg:text-5xl font-bold tracking-tight text-white text-balance">
              Solicita acceso como comercio
            </h1>
            <p className="mt-5 text-base text-[#8b8baa] leading-relaxed">
              Déjanos tus datos de contacto. Te enviaremos un enlace seguro para completar el perfil de tu negocio.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/4 p-8 lg:p-10 backdrop-blur-sm">
            <MerchantSignupForm />
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
