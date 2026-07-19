import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Appia — own Solana from the wallet you already have",
  description:
    "Pay USDC from your own L2. Appia buys SOL and stakes it with Marinade — the position belongs to your key.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers><div className="app">{children}</div></Providers>
      </body>
    </html>
  );
}
