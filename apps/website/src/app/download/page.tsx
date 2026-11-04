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
  const windowsAsset = primaryAssetFor("windows");

  return (
    <ContentPage>
      <ContentHero
        eyebrow="Get Newton"
        title="Download Newton."
        subtitle="Free to start. Windows and macOS today — a web version is on the way, and Linux isn't published yet."
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
          <a
            href={windowsAsset.url}
            className={`${styles.primaryCard} ${platform === "windows" ? styles.primaryCardDetected : ""}`}
          >
            {platform === "windows" && <span className={styles.detectedBadge}>Detected: your computer</span>}
            <span className={styles.primaryCardTitle}>Download for Windows</span>
            <span className={styles.primaryCardDetail}>{windowsAsset.detail}</span>
          </a>
        </div>

        <p className={styles.signingNote}>
          These installers aren&apos;t code-signed with a paid Microsoft/Apple certificate
          yet, so Windows SmartScreen or macOS Gatekeeper will warn about an unrecognized
          publisher the first time you run one. They&apos;re real, unmodified builds from
          this project&apos;s own public release pipeline — not a sign anything&apos;s
          wrong — and update-signature verification (a separate mechanism) already
          applies to every automatic update after install.
        </p>

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
            <ul className={styles.assetList}>
              {ASSETS.filter((a) => a.platform === "windows").map((asset) => (
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
