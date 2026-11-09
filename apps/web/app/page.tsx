import { PillNavbar } from "../components/navigation/PillNavbar";
import { HeroSection } from "../components/landing/HeroSection";
import { HowItWorksSection } from "../components/landing/HowItWorksSection";
import { ProductStats } from "../components/landing/ProductStats";
import { PrimitiveCards } from "../components/landing/PrimitiveCards";
import { FinalCTA } from "../components/landing/FinalCTA";
import { Footer } from "../components/landing/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <PillNavbar />
      <main id="product">
        <HeroSection />
        <HowItWorksSection />
        <ProductStats />
        <PrimitiveCards />
        <div className="px-6 pb-28">
          <FinalCTA />
        </div>
      </main>
      <Footer />
    </div>
  );
}
