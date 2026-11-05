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
import AmbientBackground from "@/components/AmbientBackground";

export const metadata: Metadata = {
  // Required for Next.js to resolve the opengraph-image.png file-convention route
  // (src/app/opengraph-image.png) to a real absolute URL in the <meta property="og:image">
  // tag it generates -- without this, a real sharer (iMessage/Slack/Twitter) gets
  // "http://localhost:3000/opengraph-image.png" baked into the page, which resolves to
  // nothing for them. Confirmed via `next build`'s own warning before this was added:
  // "metadataBase property in metadata export is not set ... using 'http://localhost:3000'".
  metadataBase: new URL("https://newton.best"),
  title: "Newton",
  description:
    "Newton is an Agentic Learning Environment: a native desktop study companion that connects to your real coursework, reads your syllabus to build a study plan, and solves problems with actual tools.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AmbientBackground />
        {children}
      </body>
    </html>
  );
}
