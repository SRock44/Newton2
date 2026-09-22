import type { Metadata } from "next";
import { ContentPage, ContentHero } from "@/components/ContentPage";
import styles from "./about.module.css";

// No invented team, no "founded in [year]," no company history — none of that is real
// or known. This page is built entirely around Newton's actual, established mission and
// the specific, real mechanisms that back it up (see ROADMAP.md's "verified, not vibes"
// framing and Focus Mode/check_code_work's real server-side design), not generic
// "we believe in the power of AI" filler.
const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "A computed answer and a reasoned guess are not the same thing.",
    body:
      "Most AI tutors produce one kind of output: plausible-sounding text. Newton produces two, and tells you which one you got. Factor a polynomial and it runs real symbolic algebra (SymPy) to get there. Balance a chemical equation and it solves real linear algebra over the element-composition matrix — and says so honestly, rather than guessing, when the system is underdetermined. Check your own code and it actually runs your code against real tests in a sandbox. The green \"Verified\" badge that shows up on some replies isn't the model's own self-assessment — it's a signal Newton's backend computes independently, checking whether the underlying tool result actually came from real computation before it ever renders. Where no algorithm exists — a proof's logical validity, an essay's argument quality — Newton says so plainly instead of dressing a judgment call up as a fact.",
  },
  {
    title: "Coaching, not answer-dumping — enforced by the server, not just asked of the model.",
    body:
      "A student can turn on Focus Mode, and when they do, Newton's backend itself holds the final answer back — it inspects its own draft reply before the student ever sees it, and blocks a clean direct-answer dump unless the student has made a real attempt or explicitly asks to be checked. That's a real, code-level check, not a politely-worded instruction the model could quietly ignore under prompting pressure. get_math_hint works the same way in spirit: a genuine three-level ladder (a conceptual nudge, then a concrete first step, then the answer) instead of one flat reveal.",
  },
  {
    title: "Checks your work. Never substitutes its own.",
    body:
      "check_code_work runs the student's own code, byte-for-byte as submitted, against real tests and reports exactly what happened — it does not write, repair, or \"helpfully\" rewrite a student's submission, by design, at every layer including the sandbox itself. check_proof_work is the same discipline applied to a written proof: it verifies any real algebraic sub-step computationally, and gives a structural critique of the logical technique (induction, contradiction, contrapositive, case analysis) — clearly labeled as reasoning-based critique, never blurred together with the parts that were actually computed. The point isn't just accuracy. It's that a tutor which hands you its own corrected version teaches you to trust the tutor; a tutor that tells you exactly where your own version went wrong teaches you to trust your own next attempt.",
  },
  {
    title: "Memory that respects a whole semester, not just a conversation.",
    body:
      "Flashcards are scheduled with FSRS — the same forgetting-curve research serious spaced-repetition tools use — not an arbitrary review interval. A weak-areas engine reads your real, accumulated performance history (which flashcards you keep missing, which practice-exam questions you got wrong) and opens a review queue pre-filtered to exactly that material, rather than a generic \"review everything\" button. Documents you upload stay in a persistent, searchable library for the rest of the term, so a question that spans several readings gets an answer that actually draws from each of them — not a chat that forgets everything the moment it ends.",
  },
];

export const metadata: Metadata = {
  title: "About — Newton",
  description: "What Newton believes about how AI should help a student learn, grounded in the real mechanisms already built.",
};

export default function AboutPage() {
  return (
    <ContentPage>
      <ContentHero
        eyebrow="Why Newton exists"
        title="An Agentic Learning Environment, not another chat window."
        subtitle="This isn't a mission statement written first and built around later. Every claim below points at a real, specific mechanism already in the product."
      />

      <section className={styles.section} aria-label="What Newton believes">
        <div className={styles.intro}>
          <p>
            Most AI study tools are a chat window with an education-flavored system
            prompt — the model still guesses at math, still can&apos;t tell you whether an
            answer is certain or plausible, and still can&apos;t remember your semester once
            the conversation ends. Newton is built differently, on purpose, in ways that
            show up as real, running code rather than marketing language:
          </p>
        </div>

        <div className={styles.principles}>
          {PRINCIPLES.map((principle) => (
            <div key={principle.title} className={styles.principle}>
              <h2 className={styles.principleTitle}>{principle.title}</h2>
              <p className={styles.principleBody}>{principle.body}</p>
            </div>
          ))}
        </div>

        <p className={styles.closing}>
          None of this is finished — Newton ships new tools and closes real, specific
          gaps constantly, and says so plainly rather than presenting a polished façade.
          See the{" "}
          <a href="/changelog" className={styles.link}>
            changelog
          </a>{" "}
          for what&apos;s actually shipped, and the{" "}
          <a href="/roadmap" className={styles.link}>
            roadmap
          </a>{" "}
          for what&apos;s genuinely next, honestly labeled as planned rather than built.
        </p>
      </section>
    </ContentPage>
  );
}
