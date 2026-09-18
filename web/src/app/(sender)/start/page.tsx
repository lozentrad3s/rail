import type { Metadata } from "next";
import { StartScreen } from "@/components/sender/start-screen";

export const metadata: Metadata = {
  title: "Set up your Rail account",
  description: "Set up your Rail account with Face ID. No password, nothing to write down.",
};

export default function StartPage() {
  return <StartScreen />;
}
