import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import MessageContent from "../MessageContent";
import ArtifactBlock, { ARTIFACT_SANDBOX, parseArtifactBlock } from "../ArtifactBlock";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));

const ARTIFACT_HTML =
  '<!DOCTYPE html><html><head><style>body{color:#111}</style></head>' +
  "<body><h1>Nitrogen Cycle</h1><script>console.log(1)</script></body></html>";

const BLOCK_JSON = JSON.stringify({
  document_id: "11111111-2222-3333-4444-555555555555",
  title: "Nitrogen Cycle",
  kind: "diagram",
  attempts: 1,
});

/** waitFor only retries while its callback THROWS, so a callback that returns null on a
 * not-yet-rendered iframe would resolve immediately with null. This throws instead. */
async function findFrame(container: HTMLElement): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const el = container.querySelector("iframe");
    if (!el) throw new Error("iframe not rendered yet");
    return el as HTMLIFrameElement;
  });
}

function mockRawFetch(html = ARTIFACT_HTML) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ArtifactBlock", () => {
  it("renders the kind badge and title, and fetches the artifact's real bytes", async () => {
    const fetchMock = mockRawFetch();
    render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);

    expect(screen.getByText("Diagram")).toBeInTheDocument();
    expect(screen.getByText("Nitrogen Cycle")).toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    // The block carries only a document id — the HTML is never inlined in chat.
    expect(url).toContain("/documents/11111111-2222-3333-4444-555555555555/raw");
    expect(init.headers.Authorization).toBe("Bearer tok-123");
  });

  it("renders the artifact into an iframe via srcDoc", async () => {
    mockRawFetch();
    const { container } = render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);

    const frame = await waitFor(() => {
      const el = container.querySelector("iframe");
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });
    expect(frame.getAttribute("srcdoc")).toBe(ARTIFACT_HTML);
    // srcDoc, never src=<the authenticated raw URL> — the frame performs no top-level
    // navigation to an app URL at all.
    expect(frame.getAttribute("src")).toBeNull();
  });

  // ─── The security requirement. These are the tests that must never be relaxed. ───
  describe("iframe sandboxing", () => {
    it("sandboxes the frame with allow-scripts", async () => {
      mockRawFetch();
      const { container } = render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);
      const frame = await findFrame(container);
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    });

    it("NEVER grants allow-same-origin (which would hand artifact JS the app's origin)", async () => {
      mockRawFetch();
      const { container } = render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);
      const frame = await findFrame(container);
      const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/);
      expect(tokens).not.toContain("allow-same-origin");
    });

    it("grants no other escape hatches either (top-navigation, popups, forms, modals)", async () => {
      mockRawFetch();
      const { container } = render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);
      const frame = await findFrame(container);
      const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/);
      for (const forbidden of [
        "allow-same-origin",
        "allow-top-navigation",
        "allow-top-navigation-by-user-activation",
        "allow-popups",
        "allow-forms",
        "allow-modals",
        "allow-downloads",
        "allow-pointer-lock",
        "allow-presentation",
      ]) {
        expect(tokens).not.toContain(forbidden);
      }
    });

    it("the exported sandbox constant is exactly allow-scripts", () => {
      // Guards the constant itself, so a future edit widening it fails here even if no
      // one re-reads the rendered attribute assertions above.
      expect(ARTIFACT_SANDBOX).toBe("allow-scripts");
    });
  });

  describe("download", () => {
    it("writes the artifact's exact bytes to the chosen path", async () => {
      const user = userEvent.setup();
      mockRawFetch();
      vi.mocked(save).mockResolvedValue("C:/tmp/Nitrogen Cycle.html");
      render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);

      const button = await screen.findByRole("button", { name: /download nitrogen cycle/i });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);

      await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
      const [path, bytes] = vi.mocked(writeFile).mock.calls[0];
      expect(path).toBe("C:/tmp/Nitrogen Cycle.html");
      expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(ARTIFACT_HTML);
      expect(await screen.findByText("Saved.")).toBeInTheDocument();
    });

    it("offers an .html filter and defaults the filename to the artifact's title", async () => {
      const user = userEvent.setup();
      mockRawFetch();
      vi.mocked(save).mockResolvedValue("C:/tmp/Nitrogen Cycle.html");
      render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);

      const button = await screen.findByRole("button", { name: /download nitrogen cycle/i });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);

      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(vi.mocked(save).mock.calls[0][0]).toEqual({
        defaultPath: "Nitrogen Cycle.html",
        filters: [{ name: "HTML file", extensions: ["html"] }],
      });
    });

    it("says nothing when the student cancels the save dialog", async () => {
      const user = userEvent.setup();
      mockRawFetch();
      vi.mocked(save).mockResolvedValue(null);
      render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);

      const button = await screen.findByRole("button", { name: /download nitrogen cycle/i });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);

      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(writeFile).not.toHaveBeenCalled();
      expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    });
  });

  // One real label per kind in create_artifact.py's ARTIFACT_KINDS. The default here is
  // the bare word "Artifact", so a kind that isn't in the map doesn't look broken — it
  // just silently loses its name, which is exactly why this is asserted per kind.
  describe("kind labels", () => {
    it.each([
      ["diagram", "Diagram"],
      ["chart", "Chart"],
      ["slideshow", "Slideshow"],
      ["interactive", "Interactive"],
      ["quiz", "Quiz game"],
    ])("labels a %s artifact as %s", (kind, label) => {
      mockRawFetch();
      render(
        <ArtifactBlock
          json={JSON.stringify({ document_id: "d-1", title: "T", kind, attempts: 1 })}
          token="tok-123"
        />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText("Artifact")).not.toBeInTheDocument();
    });

    it("still falls back to a generic label for a kind this build doesn't know", () => {
      mockRawFetch();
      render(
        <ArtifactBlock
          json={JSON.stringify({ document_id: "d-1", title: "T", kind: "hologram" })}
          token="tok-123"
        />,
      );
      expect(screen.getByText("Artifact")).toBeInTheDocument();
    });
  });

  it("renders a real quiz artifact's HTML into the same sandboxed frame", async () => {
    const quizHtml =
      "<!DOCTYPE html><html><body><h1>Bio 101 drill</h1>" +
      "<script>const Q=[{q:'Which enzyme unwinds DNA?',a:'Helicase.'}]</script></body></html>";
    mockRawFetch(quizHtml);
    const { container } = render(
      <ArtifactBlock
        json={JSON.stringify({ document_id: "d-9", title: "Bio 101 drill", kind: "quiz", attempts: 1 })}
        token="tok-123"
      />,
    );
    const frame = await findFrame(container);
    // A quiz is arbitrary agent-written JS like every other artifact — same sandbox, no
    // allow-same-origin, and the same srcdoc path.
    expect(frame.getAttribute("sandbox")).toBe(ARTIFACT_SANDBOX);
    await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain("Helicase."));
  });

  describe("failure states", () => {
    it("shows an error instead of throwing for malformed JSON", () => {
      render(<ArtifactBlock json="not valid json" token="tok-123" />);
      expect(screen.getByText(/couldn't render this artifact/i)).toBeInTheDocument();
    });

    it("shows an error when document_id is missing", () => {
      render(<ArtifactBlock json={JSON.stringify({ title: "T", kind: "chart" })} token="tok-123" />);
      expect(screen.getByText(/couldn't render this artifact/i)).toBeInTheDocument();
    });

    it("shows an honest message, and fires no request, with no token", async () => {
      const fetchMock = mockRawFetch();
      render(<ArtifactBlock json={BLOCK_JSON} />);
      expect(await screen.findByText(/not signed in/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("shows an error when the raw fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      render(<ArtifactBlock json={BLOCK_JSON} token="tok-123" />);
      expect(await screen.findByText(/couldn't load this artifact/i)).toBeInTheDocument();
    });
  });

  describe("parseArtifactBlock", () => {
    it("defaults attempts to 1 when absent", () => {
      const parsed = parseArtifactBlock(JSON.stringify({ document_id: "d", title: "T", kind: "chart" }));
      expect(parsed).toEqual({ documentId: "d", title: "T", kind: "chart", attempts: 1 });
    });

    it("returns null for a blank title", () => {
      expect(parseArtifactBlock(JSON.stringify({ document_id: "d", title: "   " }))).toBeNull();
    });
  });

  describe("dispatch from a chat message", () => {
    it("renders a fenced ```newton-artifact block as a live sandboxed artifact", async () => {
      mockRawFetch();
      const { container } = render(
        <MessageContent content={"Here it is:\n\n```newton-artifact\n" + BLOCK_JSON + "\n```"} token="tok-123" />,
      );
      const frame = await findFrame(container);
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(screen.getByText("Nitrogen Cycle")).toBeInTheDocument();
      // Never rendered as a plain code block with a copy button.
      expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    });

    it("still renders when the model glued the opening fence to the previous line", async () => {
      // The exact shape observed from the deployed backend: a real, successfully-built
      // artifact whose fence was welded to the end of the sentence before it, which used
      // to degrade into raw JSON behind a Copy button. See lib/fencedBlocks.ts.
      mockRawFetch();
      const { container } = render(
        <MessageContent
          content={"Building it now — hang tight.```newton-artifact\n" + BLOCK_JSON + "\n```\n\nThere it is."}
          token="tok-123"
        />,
      );
      const frame = await findFrame(container);
      expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(screen.getByText("Nitrogen Cycle")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^copy$/i })).not.toBeInTheDocument();
    });
  });
});
