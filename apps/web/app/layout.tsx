import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./lib/client/providers";

export const metadata: Metadata = {
  title: "Omnii",
  description: "Private video meetings, confidential voting, and verifiable decision records on Solana.",
};

// System font stack via CSS var(--font-sans) in globals.css (no build-time font
// download; keeps builds offline-safe).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
