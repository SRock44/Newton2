import { continueRender, delayRender } from "remotion";
import { ARTIFACT_DOCUMENT_ID, DOC, DOC_CONTENT, OLD_DOCS } from "./data";
import { beamArtifactBytes } from "./artifact";

// The Documents page and the chat's artifact block fetch from the API on mount. This film
// renders frame by frame, so every request holds the frame's render open (delayRender) until
// the response has been consumed and React has committed it -- otherwise a frame could be
// screenshotted before its data arrived.
const API_BASE = "http://127.0.0.1:58001";

export interface EngineDoc {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
  has_bibliography?: boolean;
}

/** Set (synchronously, during render) by the film before the Documents page mounts. */
export const engineState: { docs: EngineDoc[] } = { docs: [] };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(API_BASE)) return realFetch(input, init);
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

  let res: Response;
  if (method === "GET" && path === "/documents") {
    res = json(engineState.docs);
  } else if (method === "GET" && /^\/documents\/[^/]+\/content$/.test(path)) {
    const id = path.split("/")[2];
    if (id === DOC.id) res = json({ content: DOC_CONTENT, editable: false });
    else {
      const old = OLD_DOCS.find((d) => d.id === id);
      res = json({ content: old?.text ?? "", editable: !!old && !old.mime_type.includes("pdf") });
    }
  } else if (method === "GET" && path === `/documents/${ARTIFACT_DOCUMENT_ID}/raw`) {
    const bytes = await beamArtifactBytes();
    res = new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "text/html" } });
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
      learn_mode_enabled: true,
    });
  } else {
    res = json({});
  }
  release();
  return res;
};
