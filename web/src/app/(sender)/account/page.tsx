import type { Metadata } from "next";
import { AccountScreen } from "@/components/sender/account-screen";

export const metadata: Metadata = {
  title: "Your Rail account",
};

export default function AccountPage() {
  return <AccountScreen />;
}
