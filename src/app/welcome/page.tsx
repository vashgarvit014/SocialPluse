import type { Metadata } from "next";
import LandingClient from "./landing-client";

export const metadata: Metadata = {
  title: "SocialPulse — Create. Brand. Schedule. Grow.",
  description: "An AI-powered social media workspace for creating, previewing, scheduling, and publishing content across LinkedIn, Facebook, Instagram, and WhatsApp.",
};

export default function WelcomePage() {
  return <LandingClient />;
}
