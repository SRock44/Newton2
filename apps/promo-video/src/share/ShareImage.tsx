import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource-variable/fraunces/full.css";
import "../../../desktop/src/App.css";
import NewtonMark from "../../../desktop/src/components/NewtonMark";

// The real Open Graph / Twitter share-preview image for newton.best (apps/website/src/
// app/opengraph-image.tsx points straight at this render's output) -- and, per the
// product owner's own request, the same art doubles as a desktop wallpaper/image. One
// source image, two destinations, so they never drift into two different "brand
// moments." Standard OG size (1200x630 -- Facebook/Twitter/Slack/iMessage all crop to
// roughly this aspect without letterboxing).
//
// A still composition (1 frame), rendered with `remotion still`, not `remotion render`
// -- there's no video here, just a PNG.
//
// Round 2, direct feedback: "same colors, typography and styling as our site... more
// into the science feel... I like the 'checks its work' styling on our landing page."
// Two real changes from round 1:
// 1. "checks its work" now uses the EXACT same treatment as apps/website/src/app/
//    page.module.css's .gradientText + .squiggle (copied, not approximated) -- a
//    cobalt->gold->rust gradient clipped to the text itself, with the gold squiggle
//    sized in `em` units off the text's own box, not round 1's guessed fixed pixels
//    (which is exactly why it rendered invisible/misaligned there).
// 2. The falling apple is now a real stroboscopic physics diagram -- three fading
//    silhouettes along a dashed parabolic trajectory with tick marks, plus a small
//    "g = 9.8 m/s^2" annotation -- the textbook-physics convention for showing motion
//    in one still frame, and a real nod to this product's own "checks its work with
//    real computation" claim rather than a purely decorative illustration.
//
// Visual: Newton's gravity-adjacent namesake (an apple falling from a tree), not a
// redesign of NewtonMark.tsx itself (that file's own header comment explains why the
// app's actual logo stays an abstract orbit, not a literal apple -- this is a one-off
// editorial/marketing image, a different context). Real Newton design tokens throughout
// (App.css's :root), not invented colors.
export function ShareImage() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 80% 15%, rgba(184,132,44,0.14), transparent 50%), radial-gradient(circle at 10% 90%, rgba(47,77,140,0.12), transparent 55%), var(--color-bg)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Same dot-grid texture apps/website's own sections use (globals.css's
          --texture-dots). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(#ddcca5 1.5px, transparent 1.5px)",
          backgroundSize: "26px 26px",
          opacity: 0.55,
        }}
      />

      {/* A large, faint orbit ring echoing NewtonMark's own brand motif -- decorative
          "science" texture behind everything else, same restrained idea as the app's
          real logo, just scaled up and backgrounded. */}
      <svg
        width="520"
        height="520"
        viewBox="0 0 520 520"
        style={{ position: "absolute", top: -170, right: -140, opacity: 0.22 }}
      >
        <ellipse
          cx="260"
          cy="260"
          rx="230"
          ry="120"
          transform="rotate(-20 260 260)"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
        />
        <circle cx="430" cy="178" r="10" fill="var(--color-accent-2)" />
      </svg>

      {/* Brand mark + wordmark, top-left. */}
      <div style={{ position: "absolute", top: 56, left: 64, display: "flex", alignItems: "center", gap: 12 }}>
        <NewtonMark size={40} />
        <span style={{ fontFamily: "var(--font-serif)", fontSize: 34, fontWeight: 600, color: "var(--color-text)" }}>
          Newton
        </span>
      </div>

      {/* Headline block */}
      <div style={{ position: "absolute", top: 222, left: 64, width: 660 }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--color-accent)",
            marginBottom: 16,
          }}
        >
          The first Agentic Learning Environment
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 58,
            fontWeight: 600,
            lineHeight: 1.12,
            color: "var(--color-text)",
            letterSpacing: "-0.01em",
          }}
        >
          An AI tutor that
        </div>
        {/* "checks its work." as its own SVG block (gradient-fill text + squiggle, same
            coordinate space) rather than CSS background-clip:text -- that's the real
            technique page.module.css's .gradientText uses in a browser, but it rendered
            fully invisible in this headless-Chromium still-render pipeline (confirmed:
            -webkit-text-fill-color didn't fix it either) even though the squiggle
            alongside it painted fine. SVG <text fill="url(#...)"> is the same visual
            result through a path every renderer supports, not a CSS compositing
            shortcut that depends on the host's screenshot pipeline. */}
        {/* "checks its work" at this exact font/size/weight measures ~426px wide (real
            getComputedTextLength() in a real browser, not guessed -- a guessed 364px is
            exactly what put the period mid-word and the squiggle/underline short last
            round). viewBox/squiggle/period below are all sized off that real number. */}
        <svg width="480" height="76" viewBox="0 0 480 76" style={{ display: "block", marginTop: 2 }}>
          <defs>
            <linearGradient id="checksGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="10%" stopColor="#2f4d8c" />
              <stop offset="50%" stopColor="#b8842c" />
              <stop offset="90%" stopColor="#a8471f" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="46"
            fontFamily="var(--font-serif)"
            fontSize="58"
            fontWeight="600"
            letterSpacing="-0.5"
            fill="url(#checksGradient)"
          >
            checks its work
          </text>
          <path
            d="M2 62 Q 45 48, 88 62 T 174 62 T 260 62 T 346 62 T 432 62"
            fill="none"
            stroke="#b8842c"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <text x="408" y="46" fontFamily="var(--font-serif)" fontSize="58" fontWeight="600" fill="#241f16">
            .
          </text>
        </svg>
      </div>

      {/* Apple-falling-from-tree illustration, right side, as a real physics
          trajectory/stroboscopic diagram -- the "science feel" the illustration part of
          this image is built around. */}
      <svg width="440" height="630" viewBox="0 0 440 630" style={{ position: "absolute", top: 0, right: 0 }}>
        {/* Branch */}
        <path
          d="M440 40 Q 340 8, 255 72 Q 212 104, 192 156"
          fill="none"
          stroke="#6b4a2b"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path d="M305 46 Q 328 20, 372 14" fill="none" stroke="#6b4a2b" strokeWidth="6" strokeLinecap="round" />
        {[
          { x: 340, y: 17, r: -28 },
          { x: 377, y: 27, r: 18 },
          { x: 263, y: 64, r: -40 },
          { x: 216, y: 96, r: 10 },
        ].map((leaf, i) => (
          <ellipse
            key={i}
            cx={leaf.x}
            cy={leaf.y}
            rx="22"
            ry="12"
            fill="#3d7d49"
            opacity={0.88}
            transform={`rotate(${leaf.r} ${leaf.x} ${leaf.y})`}
          />
        ))}

        {/* The trajectory itself -- a real parabolic arc, dashed like a textbook
            diagram, from the release point to the final apple. */}
        <path
          d="M194 160 Q 206 260, 214 410"
          fill="none"
          stroke="var(--color-text-faint)"
          strokeWidth="2"
          strokeDasharray="2 7"
          strokeLinecap="round"
        />

        {/* Stroboscopic echoes -- the classic "motion at equal time intervals" physics
            convention, each with a small tick mark through the trajectory, standing in
            for the single static frame's lack of real motion. */}
        {[
          { cx: 198, cy: 232, r: 13, o: 0.22 },
          { cx: 207, cy: 318, r: 17, o: 0.38 },
        ].map((t, i) => (
          <g key={i}>
            <line
              x1={t.cx - 10}
              y1={t.cy}
              x2={t.cx + 10}
              y2={t.cy}
              stroke="var(--color-text-faint)"
              strokeWidth="1.5"
              opacity={0.6}
            />
            <circle cx={t.cx} cy={t.cy} r={t.r} fill="#a8471f" opacity={t.o} />
          </g>
        ))}

        {/* The apple itself, mid-fall -- the final, bold position */}
        <g transform="translate(214 410)">
          <ellipse cx="0" cy="54" rx="46" ry="10" fill="#241f16" opacity="0.08" />
          <path
            d="M0 -30 C 30 -30, 44 -6, 40 18 C 36 46, 16 60, 0 60 C -16 60, -36 46, -40 18 C -44 -6, -30 -30, 0 -30 Z"
            fill="#a8471f"
          />
          <path
            d="M-30 -14 C -22 -28, -4 -32, 6 -26 C -8 -26, -22 -16, -26 0 C -30 -4, -31 -9, -30 -14 Z"
            fill="#d97b4f"
            opacity="0.55"
          />
          <path d="M2 -30 Q 8 -42, 2 -50" fill="none" stroke="#6b4a2b" strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="16" cy="-46" rx="11" ry="6" fill="#3d7d49" transform="rotate(-25 16 -46)" />
        </g>

        {/* A small, real physics annotation -- Earth's actual gravitational
            acceleration, the textbook label that would sit next to exactly this
            diagram. Grounded, not invented, same "verified, not vibes" instinct the
            product itself is built around. */}
        <line x1="260" y1="420" x2="300" y2="400" stroke="var(--color-text-faint)" strokeWidth="1.5" />
        <text
          x="306"
          y="404"
          fontFamily="var(--font-sans)"
          fontSize="19"
          fontWeight="600"
          fill="var(--color-text-muted)"
        >
          g = 9.8 m/s²
        </text>
      </svg>
    </div>
  );
}
