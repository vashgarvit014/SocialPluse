import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./_shell/sp-theme.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spDisplay = Space_Grotesk({
  variable: "--font-sp-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spBody = Manrope({
  variable: "--font-sp-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const spMono = JetBrains_Mono({
  variable: "--font-sp-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Social Media Manager Dashboard",
  description: "AI-powered social media content creation and LinkedIn publishing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spDisplay.variable} ${spBody.variable} ${spMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
