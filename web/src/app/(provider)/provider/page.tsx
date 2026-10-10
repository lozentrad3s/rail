import type { Metadata } from "next";
import { ProviderEntry } from "@/components/provider/provider-entry";

export const metadata: Metadata = {
  title: "Become a Rail provider",
  description:
    "Stake dollars, bid on transfers, pay from your own bank account and collect your bid. No application and no approval.",
};

export default function ProviderPage() {
  return <ProviderEntry />;
}
