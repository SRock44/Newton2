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
  // desktop-v0.2.0 --json assets), not invented — see downloadAssets.ts's own comment.
  it("links every real published asset, with the exact real GitHub Release URL", () => {
    render(<DownloadPage />);
    const real = [
      ["macOS — Apple Silicon", "https://github.com/SRock44/Newton2/releases/download/desktop-v0.2.0/Newton_0.2.0_aarch64.dmg"],
      ["macOS — Intel", "https://github.com/SRock44/Newton2/releases/download/desktop-v0.2.0/Newton_0.2.0_x64.dmg"],
      ["Windows — Installer", "https://github.com/SRock44/Newton2/releases/download/desktop-v0.2.0/Newton_0.2.0_x64-setup.exe"],
      ["Windows — MSI", "https://github.com/SRock44/Newton2/releases/download/desktop-v0.2.0/Newton_0.2.0_x64_en-US.msi"],
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

  it("warns honestly about the unsigned installers rather than hiding it", () => {
    render(<DownloadPage />);
    expect(screen.getByText(/smartscreen/i)).toBeInTheDocument();
    expect(screen.getByText(/gatekeeper/i)).toBeInTheDocument();
  });

  it("links out to the real GitHub release notes", () => {
    render(<DownloadPage />);
    expect(screen.getByRole("link", { name: /release notes on github/i })).toHaveAttribute(
      "href",
      "https://github.com/SRock44/Newton2/releases/tag/desktop-v0.2.0"
    );
  });

  it("detects a Mac and marks the Mac primary button, not the Windows one", async () => {
    stubUserAgent(MAC_UA);
    render(<DownloadPage />);
    expect(await screen.findByText(/detected: your computer/i)).toBeInTheDocument();
    const macCard = screen.getByRole("link", { name: /download for mac/i });
    expect(macCard).toContainElement(screen.getByText(/detected: your computer/i));
  });

  it("detects Windows and marks the Windows primary button, not the Mac one", async () => {
    stubUserAgent(WINDOWS_UA);
    render(<DownloadPage />);
    expect(await screen.findByText(/detected: your computer/i)).toBeInTheDocument();
    const winCard = screen.getByRole("link", { name: /download for windows/i });
    expect(winCard).toContainElement(screen.getByText(/detected: your computer/i));
  });

  it("marks neither button on an undetected platform (e.g. Linux) rather than guessing", () => {
    stubUserAgent(LINUX_UA);
    render(<DownloadPage />);
    expect(screen.queryByText(/detected: your computer/i)).not.toBeInTheDocument();
  });
});
