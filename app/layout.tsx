import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["300", "400", "500"] });

export const metadata: Metadata = {
  title: "LeanFetch: API Cost Auditor",
  description: "a tool that stops startups from losing cash to unnecessary api calls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-white text-[#1A1A1A] min-h-screen">{children}</body>
    </html>
  );
}
