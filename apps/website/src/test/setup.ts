import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom implements no real media playback at all -- HTMLMediaElement.play()/pause()
// are simply absent, so any component that calls video.play() (AppWalkthrough's
// autoplay-on-scroll-into-view) throws "play is not a function" under jsdom with no
// stub. Global, not per-test, since any future audio/video use would hit the same gap.
window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
window.HTMLMediaElement.prototype.pause = vi.fn();
window.HTMLMediaElement.prototype.load = vi.fn();
