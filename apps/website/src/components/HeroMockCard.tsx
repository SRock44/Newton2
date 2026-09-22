"use client";

import { useEffect, useState } from "react";
import styles from "@/app/page.module.css";

/**
 * The hero's worked-example card — deliberately not a static screenshot. It floats
 * gently (see page.module.css's mock-card-float, disabled under reduced motion) and its
 * real computed result and Verified badge reveal in a short animated sequence right
 * after mount, rather than all three lines sitting there fully rendered and static from
 * frame one. The same worked example appears again (statically) further down the page
 * in the "Verified, not vibes" section — this is the one animated moment of it, not a
 * second, different claim.
 */
export default function HeroMockCard() {
  const [resultVisible, setResultVisible] = useState(false);
  const [badgeVisible, setBadgeVisible] = useState(false);

  useEffect(() => {
    const resultTimer = setTimeout(() => setResultVisible(true), 700);
    return () => clearTimeout(resultTimer);
  }, []);

  useEffect(() => {
    if (!resultVisible) return;
    const badgeTimer = setTimeout(() => setBadgeVisible(true), 380);
    return () => clearTimeout(badgeTimer);
  }, [resultVisible]);

  return (
    <div className={styles.mockCard}>
      <p className={styles.mockCardLabel}>NEWTON</p>
      <p className={styles.mockCardPrompt}>Factor x² + 5x + 6</p>
      <p className={`${styles.mockCardResult} ${resultVisible ? styles.mockCardResultVisible : ""}`}>
        = (x + 2)(x + 3)
      </p>
      <span
        className={`${styles.verifiedBadge} ${styles.mockCardBadgeReveal} ${
          badgeVisible ? styles.mockCardBadgeRevealVisible : ""
        }`}
      >
        <svg viewBox="0 0 16 16" className={styles.verifiedIcon} focusable="false">
          <path fill="currentColor" d="M6.5 11.5 3 8l1.06-1.06L6.5 9.38l5.44-5.44L13 5l-6.5 6.5Z" />
        </svg>
        Verified — real symbolic computation
      </span>
    </div>
  );
}
