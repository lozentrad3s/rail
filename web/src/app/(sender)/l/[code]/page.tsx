import type { Metadata } from "next";
import { ConnectScreen } from "@/components/sender/connect-screen";

export const metadata: Metadata = {
  title: "Connect your chat",
  description: "Connect your chat to your Rail account with Face ID.",
};

export default async function ConnectPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ConnectScreen code={code} />;
}
