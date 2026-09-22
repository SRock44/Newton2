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
