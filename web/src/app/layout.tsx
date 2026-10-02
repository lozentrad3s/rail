import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, Roboto_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  axes: ["opsz"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rail: send money home, straight from a chat",
  description:
    "Confirm with Face ID and your family's bank receives naira. Local providers compete in a sealed auction to deliver every transfer, and the saving comes back to you.",
  applicationName: "Rail",
  openGraph: {
    title: "Rail: send money home, straight from a chat",
    description:
      "Providers compete in a sealed auction to deliver your transfer. Rail never touches your money.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e091c",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${robotoMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
