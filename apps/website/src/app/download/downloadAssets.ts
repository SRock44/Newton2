/** Real GitHub Release assets — the exact 11 files `desktop-v0.1.0` actually publishes
 * (confirmed via `gh release view desktop-v0.1.0 --json assets` before writing this, not
 * guessed), produced by .github/workflows/release.yml. Stable per-asset download URLs
 * (github.com/.../releases/download/<tag>/<asset>) need no API call at request/build
 * time — GitHub serves these directly, permanently, for a given tag.
 *
 * No Linux entry: the release workflow's matrix includes an ubuntu runner, but no
 * .AppImage/.deb is among the real published assets today — said honestly on the page
 * itself rather than inventing a download that doesn't exist. */

export const RELEASE_TAG = "desktop-v0.1.0";
export const RELEASE_URL = `https://github.com/SRock44/Newton2/releases/tag/${RELEASE_TAG}`;
const RELEASE_BASE = `https://github.com/SRock44/Newton2/releases/download/${RELEASE_TAG}`;

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
    url: `${RELEASE_BASE}/Newton_0.1.0_aarch64.dmg`,
  },
  {
    platform: "mac",
    label: "macOS — Intel",
    detail: "Intel-based Mac. .dmg",
    url: `${RELEASE_BASE}/Newton_0.1.0_x64.dmg`,
  },
  {
    platform: "windows",
    label: "Windows — Installer",
    detail: "Recommended for most people. .exe",
    primary: true,
    url: `${RELEASE_BASE}/Newton_0.1.0_x64-setup.exe`,
  },
  {
    platform: "windows",
    label: "Windows — MSI",
    detail: "For managed/enterprise installs. .msi",
    url: `${RELEASE_BASE}/Newton_0.1.0_x64_en-US.msi`,
  },
];

export function primaryAssetFor(platform: Platform): DownloadAsset {
  const asset = ASSETS.find((a) => a.platform === platform && a.primary);
  if (!asset) throw new Error(`no primary download asset for platform: ${platform}`);
  return asset;
}
