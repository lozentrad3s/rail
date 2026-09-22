import type { Metadata } from "next";
import { RecipientScreen } from "@/components/sender/recipient-screen";

export const metadata: Metadata = {
  title: "Add someone to send to",
  description: "Enter your recipient's bank details safely, outside the chat.",
};

export default async function RecipientPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RecipientScreen code={code} />;
}
