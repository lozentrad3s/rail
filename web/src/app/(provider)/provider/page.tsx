import type { Metadata } from "next";
import { ProviderScreen } from "@/components/provider/provider-screen";

export const metadata: Metadata = {
  title: "Become a Rail provider",
  description:
    "Stake dollars, bid on transfers, pay from your own bank account and collect your bid. No application and no approval.",
};

export default function ProviderPage() {
  return <ProviderScreen />;
}
