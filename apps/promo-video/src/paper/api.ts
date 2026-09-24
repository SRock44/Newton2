import { continueRender, delayRender, staticFile } from "remotion";
import { NOTES, OLD_DOCS, PAPER_PDF, PAPER_REUPLOAD, PAPER_TEX, SYNOPSIS } from "./data";
import { activeFilm } from "../filmId";

// The Documents page fetches from the API on mount. This film renders frame by frame, so every
// request holds the frame's render open (delayRender) until the response has been consumed and
// React has committed it -- otherwise a frame could be screenshotted before its data arrived.
const API_BASE = "http://127.0.0.1:58001";

export interface FilmDoc {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
  has_bibliography?: boolean;
}

/** Set (synchronously, during render) by the film before the Documents page mounts. */
export const filmState: { docs: FilmDoc[] } = { docs: [] };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (activeFilm.id !== "paper" || !url.startsWith(API_BASE)) return realFetch(input, init);
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const path = url.slice(API_BASE.length).split("?")[0];

  const handle = delayRender(`api ${method} ${path}`);
  const release = () =>
    window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => continueRender(handle))), 90);

  // An upload that never finishes: the page sits on its real "Uploading…" state.
  if (method === "POST" && path === "/documents/upload") {
    release();
    return new Promise<Response>(() => {});
  }

  // DocumentViewerPanel renders this with pdf.js, real page-by-page canvas + text layer -- so
  // (unlike the app's other, <iframe>-based PDF preview) it needs the finished paper's REAL
  // bytes, not a PDF-shaped stub. Its own async fetch (of the static asset this film ships,
  // public/research-paper.pdf) is why this one branch returns early instead of falling into the
  // `let res` cascade below.
  if (method === "GET" && path === `/documents/${PAPER_REUPLOAD.id}/raw`) {
    const bytes = await realFetch(staticFile("research-paper.pdf")).then((r) => r.arrayBuffer());
    release();
    return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } });
  }

  let res: Response;
  if (method === "GET" && path === "/documents") {
    res = json(filmState.docs);
  } else if (method === "GET" && /^\/documents\/[^/]+\/content$/.test(path)) {
    const id = path.split("/")[2];
    if (id === PAPER_REUPLOAD.id) {
      res = json({ content: PAPER_PDF.content, editable: false });
    } else {
      const known = [NOTES, SYNOPSIS, PAPER_PDF, PAPER_TEX].find((d) => d.doc.id === id);
      if (known) res = json({ content: known.content, editable: false });
      else {
        const old = OLD_DOCS.find((d) => d.id === id);
        res = json({ content: old?.text ?? "", editable: false });
      }
    }
  } else if (method === "GET" && path === "/billing/status") {
    res = json({
      plan: "pro",
      subscription_status: "active",
      current_period_end: null,
      credits_used_cents: 0,
      credits_limit_cents: 2000,
      credits_reset_at: null,
      preferred_pro_model: "",
      free_generation_target: 10,
      pro_generation_target: 30,
      focus_mode_enabled: false,
      topup_credits_cents: 0,
      topup_tiers_cents: [],
      learn_mode_enabled: false,
    });
  } else {
    res = json({});
  }
  release();
  return res;
};
