import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DownloadPage from "./page";

function stubUserAgent(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

describe("DownloadPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the page heading", () => {
    render(<DownloadPage />);
    expect(screen.getByRole("heading", { level: 1, name: /download newton/i })).toBeInTheDocument();
  });

  // Every href checked against the REAL release asset list (gh release view
  // desktop-v0.2.7 --json assets), not invented — see downloadAssets.ts's own comment.
  it("links every real published asset, with the exact real GitHub Release URL", () => {
    render(<DownloadPage />);
    const real = [
      ["macOS — Apple Silicon", "https://github.com/SRock44/Newton2/releases/download/desktop-v0.2.7/Newton_0.2.7_aarch64.dmg"],
      ["macOS — Intel", "https://github.com/SRock44/Newton2/releases/download/desktop-v0.2.7/Newton_0.2.7_x64.dmg"],
    ] as const;
    for (const [label, url] of real) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", url);
    }
  });

  it("never invents a Linux download — says honestly that none is published yet", () => {
    render(<DownloadPage />);
    expect(screen.getByText(/not published yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/\.appimage|\.deb/i)).not.toBeInTheDocument();
  });

  // Windows was pulled from public distribution (2026-11-11, advising professor's
  // verdict after an in-class test) — the release pipeline still builds it for the
  // team's own testing, it's just not linked from this page anymore, and there's
  // honestly no Windows installer link left to warn about.
  it("removed Windows from public distribution — no download link, no stale signing warning", () => {
    render(<DownloadPage />);
    expect(screen.queryByRole("link", { name: /download for windows/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /windows.*installer|windows.*msi/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not publicly distributed/i)).toBeInTheDocument();
    expect(screen.queryByText(/smartscreen/i)).not.toBeInTheDocument();
  });

  it("links out to the real GitHub release notes", () => {
    render(<DownloadPage />);
    expect(screen.getByRole("link", { name: /release notes on github/i })).toHaveAttribute(
      "href",
      "https://github.com/SRock44/Newton2/releases/tag/desktop-v0.2.7"
    );
  });

  it("detects a Mac and marks the Mac primary button, not the Windows one", async () => {
    stubUserAgent(MAC_UA);
    render(<DownloadPage />);
    expect(await screen.findByText(/detected: your computer/i)).toBeInTheDocument();
    const macCard = screen.getByRole("link", { name: /download for mac/i });
    expect(macCard).toContainElement(screen.getByText(/detected: your computer/i));
  });

  it("detects Windows but marks no button, since there is no Windows download to highlight", () => {
    stubUserAgent(WINDOWS_UA);
    render(<DownloadPage />);
    expect(screen.queryByText(/detected: your computer/i)).not.toBeInTheDocument();
  });

  it("marks neither button on an undetected platform (e.g. Linux) rather than guessing", () => {
    stubUserAgent(LINUX_UA);
    render(<DownloadPage />);
    expect(screen.queryByText(/detected: your computer/i)).not.toBeInTheDocument();
  });
});
