/** Real GitHub Release assets — confirmed via `gh release view desktop-v0.2.7 --json
 * assets` before writing this, not guessed — produced by .github/workflows/release.yml.
 * Stable per-asset download URLs (github.com/.../releases/download/<tag>/<asset>) need
 * no API call at request/build time — GitHub serves these directly, permanently, for a
 * given tag.
 *
 * No Linux entry: the release workflow's ubuntu-22.04 matrix leg fails today (a
 * pre-existing, unrelated upstream build break in the `libspa` crate a transitive
 * webkit2gtk/PipeWire dependency pulls in — not something this release caused), so
 * there's no real .AppImage/.deb to link to. Said honestly on the page itself rather
 * than inventing a download that doesn't exist. */

export const RELEASE_TAG = "desktop-v0.2.7";
export const RELEASE_URL = `https://github.com/SRock44/Newton2/releases/tag/${RELEASE_TAG}`;
const RELEASE_BASE = `https://github.com/SRock44/Newton2/releases/download/${RELEASE_TAG}`;

// "windows" stays in this union even though ASSETS below has no windows entries —
// page.tsx's detectPlatform() still needs to recognize a Windows visitor so it can
// honestly NOT show them a false "Detected: your computer" badge on the Mac card.
export type Platform = "mac" | "windows";

export interface DownloadAsset {
  platform: Platform;
  label: string;
  detail: string;
  /** True for the one asset each platform's "Download for ___" primary button links to. */
  primary?: boolean;
  url: string;
}

export const ASSETS: DownloadAsset[] = [
  {
    platform: "mac",
    label: "macOS — Apple Silicon",
    detail: "M1 and later. .dmg",
    primary: true,
    url: `${RELEASE_BASE}/Newton_0.2.7_aarch64.dmg`,
  },
  {
    platform: "mac",
    label: "macOS — Intel",
    detail: "Intel-based Mac. .dmg",
    url: `${RELEASE_BASE}/Newton_0.2.7_x64.dmg`,
  },
  // No Windows entries: removed from public distribution per the advising professor's
  // verdict after an in-class test (2026-11-11) -- real quality concerns found testing
  // it live, not a build failure. The release workflow (.github/workflows/release.yml)
  // still produces real Windows installers on every tag for the team's own testing;
  // they're just not linked from this public page anymore. See RELEASE_TAG's GitHub
  // Release page directly if you need one of those builds.
];

export function primaryAssetFor(platform: Platform): DownloadAsset {
  const asset = ASSETS.find((a) => a.platform === platform && a.primary);
  if (!asset) throw new Error(`no primary download asset for platform: ${platform}`);
  return asset;
}
