import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { B2BSection } from "@/components/b2b-section"
import { SecuritySection } from "@/components/security-section"
import { DashboardSection } from "@/components/dashboard-section"
import { PSPSection } from "@/components/psp-section"
import { PaymentMethodsSection } from "@/components/payment-methods-section"
import { FeaturesSection } from "@/components/features-section"
import { HowItWorksSection } from "@/components/how-it-works-section"
import { TrustSection } from "@/components/trust-section"
import { EthicsSection } from "@/components/ethics-section"
import { ContactSection } from "@/components/contact-section"
import { DevelopersSection } from "@/components/developers-section"
import { Footer } from "@/components/footer"

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <Header />
      <HeroSection />
      <B2BSection />
      <SecuritySection />
      <DashboardSection />
      <PaymentMethodsSection />
      <FeaturesSection />
      <HowItWorksSection />
      <PSPSection />
      <TrustSection />
      <EthicsSection />
      <DevelopersSection />
      <ContactSection />
      <Footer />
    </main>
  )
}
