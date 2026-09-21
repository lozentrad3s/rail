import type { Metadata } from "next";
import { ApproveScreen } from "@/components/sender/approve-screen";

export const metadata: Metadata = {
  title: "Approve your transfer",
  description: "Check the details and approve your transfer with Face ID.",
};

export default async function ApprovePage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  return <ApproveScreen draftId={draftId} />;
}
