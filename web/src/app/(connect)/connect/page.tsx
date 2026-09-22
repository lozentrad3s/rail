import type { Metadata } from "next";
import { ConnectWalletScreen } from "@/components/connect/connect-wallet-screen";

export const metadata: Metadata = {
  title: "Connect a wallet",
  description: "Use an EVM wallet you already have on Monad to send money with Rail.",
};

export default function ConnectPage() {
  return <ConnectWalletScreen />;
}
