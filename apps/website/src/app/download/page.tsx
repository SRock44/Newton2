"use client";

import { useEffect, useState } from "react";
import { ContentPage, ContentHero } from "@/components/ContentPage";
import { ASSETS, RELEASE_TAG, RELEASE_URL, primaryAssetFor } from "./downloadAssets";
import type { Platform } from "./downloadAssets";
import styles from "./download.module.css";

/** Real, best-effort platform sniffing for the one-click "Download for ___" button —
 * not a hard requirement (every real option is always listed below it regardless of what
 * this detects). `navigator.userAgent` over the deprecated `navigator.platform` apps/
 * desktop's own isMacPlatform() reads (apps/desktop/src/lib/platform.ts): that file can
 * get away with the deprecated property because it only ever needs "is this a Mac" for
 * window-chrome styling, but detecting Windows too needs a signal `platform` alone
 * doesn't reliably give across browsers, so this is a separate, from-scratch
 * implementation for apps/website specifically, not a shared one — the two apps don't
 * share a source tree the way apps/web and apps/desktop do. */
function detectPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  return null;
}

export default function DownloadPage() {
  // null until the effect below runs client-side post-mount — navigator isn't available
  // during server render, and guessing wrong for a split second (e.g. defaulting to
  // "windows") would flash the wrong button before correcting itself.
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const macAsset = primaryAssetFor("mac");

  return (
    <ContentPage>
      <ContentHero
        eyebrow="Get Newton"
        title="Download Newton."
        subtitle="Free to start. Chat right now at newton.best/chat, no download needed, or install the native macOS app below. Windows isn't publicly distributed yet, and Linux isn't published yet."
      />

      <section className={styles.section} aria-label="Download">
        <div className={styles.primaryCards}>
          <a
            href={macAsset.url}
            className={`${styles.primaryCard} ${platform === "mac" ? styles.primaryCardDetected : ""}`}
          >
            {platform === "mac" && <span className={styles.detectedBadge}>Detected: your computer</span>}
            <span className={styles.primaryCardTitle}>Download for Mac</span>
            <span className={styles.primaryCardDetail}>{macAsset.detail}</span>
          </a>
        </div>

        {/* Mac is real Apple Developer ID signed + notarized (see .github/workflows/
            release.yml) -- no Gatekeeper "unrecognized publisher" warning. Windows has
            no public download to carry a signing note about: removed from distribution
            per the advising professor's verdict after the in-class test (2026-11-11);
            the release workflow still builds it for the team's own testing, it's just
            not linked here. */}
        <h2 className={styles.allDownloadsHeading}>Every build</h2>
        <div className={styles.platformGroups}>
          <div className={styles.platformGroup}>
            <p className={styles.platformGroupLabel}>macOS</p>
            <ul className={styles.assetList}>
              {ASSETS.filter((a) => a.platform === "mac").map((asset) => (
                <li key={asset.url} className={styles.assetItem}>
                  <a href={asset.url} className={styles.assetLink}>
                    {asset.label}
                  </a>
                  <span className={styles.assetDetail}>{asset.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.platformGroup}>
            <p className={styles.platformGroupLabel}>Windows</p>
            <p className={styles.notYet}>Not publicly distributed right now.</p>
          </div>
          <div className={styles.platformGroup}>
            <p className={styles.platformGroupLabel}>Linux</p>
            <p className={styles.notYet}>Not published yet.</p>
          </div>
        </div>

        <p className={styles.releaseLink}>
          Version {RELEASE_TAG.replace("desktop-v", "")} — see the full{" "}
          <a href={RELEASE_URL}>release notes on GitHub</a>.
        </p>
      </section>
    </ContentPage>
  );
}
