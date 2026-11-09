import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./lib/client/providers";

export const metadata: Metadata = {
  title: "Concord",
  description: "Private video meetings, confidential voting, and verifiable decision records on Solana.",
};

// System font stack (no build-time font download; keeps builds offline-safe).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
