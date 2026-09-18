import type { Metadata } from "next";

// The app is private to the person holding the passkey, so it stays out of search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SenderLayout({ children }: LayoutProps<"/">) {
  return <div className="bg-paper text-ink">{children}</div>;
}
