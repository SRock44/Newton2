import type { Metadata } from "next";
// Same self-hosted font pairing as apps/desktop/src/main.tsx: Public Sans for
// body/UI text, Fraunces Variable as the editorial display face (wordmark,
// headings). Loaded the same way (not next/font/google) so the two apps
// share one typographic identity.
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
// A third, deliberately narrow-use face: real handwriting-style ink for the "graded
// paper" visual's red-pen annotation and corrected answer (src/components/
// GradedPaper.tsx) — the one place on the page something needs to look actually
// hand-marked rather than typeset. Self-hosted via @fontsource, same convention as the
// two faces above (never next/font/google, never a live Google Fonts request).
import "@fontsource/caveat/500.css";
import "@fontsource/caveat/600.css";
import "@fontsource/caveat/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newton",
  description:
    "Newton is an Agentic Learning Environment: a native desktop study companion that connects to your real coursework, reads your syllabus to build a study plan, and solves problems with actual tools.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
