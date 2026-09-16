import { Auction } from "@/components/marketing/auction";
import { Closing } from "@/components/marketing/closing";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LastMile } from "@/components/marketing/last-mile";
import { Nav } from "@/components/marketing/nav";
import { Providers } from "@/components/marketing/providers";
import { Safety } from "@/components/marketing/safety";
import { WhyMonad } from "@/components/marketing/why-monad";

// Chapter order and jobs: docs/DESIGN.md §9.
export default function LandingPage() {
  return (
    <>
      <a
        href="#last-mile"
        className="btn btn-primary fixed left-4 top-4 z-[60] -translate-y-24 focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <LastMile />
        <HowItWorks />
        <Auction />
        <Safety />
        <WhyMonad />
        <Providers />
        <Closing />
      </main>
    </>
  );
}
