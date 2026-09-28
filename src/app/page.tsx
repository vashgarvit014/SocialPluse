import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "SocialPulse — Create. Brand. Schedule. Grow.",
  description: "An AI-powered social media workspace for creating, previewing, scheduling, and publishing content across LinkedIn, Facebook, Instagram, and WhatsApp.",
};

// Defensive duplicate of the relay in /content-studio/page.tsx: the app
// shell's own comments indicate Canva's Return URL has, at some point,
// pointed at the bare domain rather than /content-studio. Handle
// correlation_jwt here too so "Edit in Canva" keeps working regardless of
// which URL is actually configured in Canva's developer portal.
export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (typeof params.correlation_jwt === 'string') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') qs.set(key, value);
    }
    redirect(`/api/canva/return?${qs.toString()}`);
  }

  return <LandingClient />;
}
