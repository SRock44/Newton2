import { continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { useEffect } from "react";
import { ARTIFACT_DOCUMENT_ID } from "./data";
import { activeFilm } from "./filmId";

// The artifact is the REAL generated HTML (see apps/website/public/demo/) rendered by the
// REAL ArtifactBlock component in its real sandboxed iframe. Remotion renders frame by
// frame, so the point can't be dragged with a real mouse; instead a tiny bridge script is
// appended to the HTML in memory (never to the shipped file) that lets the composition
// set the slider on a per-frame basis via postMessage and acknowledge once the artifact
// has redrawn — each frame's render waits (delayRender) for that acknowledgement, so
// what's captured is exactly what the artifact's own code drew for that angle.
const BRIDGE = `<script>(function(){
  var s=document.getElementById('slider'), p=document.getElementById('ptP');
  window.addEventListener('message',function(e){
    var d=e.data; if(!d||d.promo!=='angle') return;
    s.value=d.deg; s.dispatchEvent(new Event('input',{bubbles:true}));
    var r=p.getBoundingClientRect();
    parent.postMessage({promo:'ack',deg:Number(s.value),x:r.left+r.width/2,y:r.top+r.height/2},'*');
  });
  parent.postMessage({promo:'ready'},'*');
})();</script>`;

let artifactBytes: Uint8Array | null = null;

export async function loadArtifact(): Promise<void> {
  const html = await (await fetch(staticFile("unit-circle-artifact.html"))).text();
  const withBridge = html.includes("</body>") ? html.replace("</body>", BRIDGE + "</body>") : html + BRIDGE;
  artifactBytes = new TextEncoder().encode(withBridge);
}

// Started at import time: ArtifactBlock fetches on mount, which can happen before the
// composition's own asset gate resolves, so the mock itself waits for the bytes.
export const artifactReady = loadArtifact();

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (activeFilm.id !== "promo") return realFetch(input, init);
  if (url.includes(`/documents/${ARTIFACT_DOCUMENT_ID}/raw`)) {
    await artifactReady;
    return new Response((artifactBytes as Uint8Array).slice().buffer, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url.includes("/billing/") || url.includes("/gamification/") || url.includes("/documents")) {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

export const artifactPoint = { x: 0, y: 0, valid: false };

/** Sets the artifact's angle for this frame and blocks the render until it has redrawn. */
export function useArtifactDrive(active: boolean, deg: number, onAck: () => void) {
  const frame = useCurrentFrame();
  useEffect(() => {
    if (!active) return;
    const handle = delayRender(`artifact angle @${frame}`);
    let finished = false;
    const iframe = () => document.querySelector<HTMLIFrameElement>(".artifact-block__frame");
    const send = () => iframe()?.contentWindow?.postMessage({ promo: "angle", deg }, "*");
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMsg);
      window.clearTimeout(timer);
      window.clearInterval(poll);
      continueRender(handle);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.promo === "ready") send();
      if (d.promo === "ack" && d.deg === deg) {
        artifactPoint.x = d.x;
        artifactPoint.y = d.y;
        artifactPoint.valid = true;
        onAck();
        finish();
      }
    };
    window.addEventListener("message", onMsg);
    send();
    // While waiting, keep re-stabilizing the layout (the artifact iframe appears async and
    // grows the chat pane): onAck re-pins the scroll and forces the lazy iframe to load.
    const poll = window.setInterval(() => {
      onAck();
      send();
    }, 200);
    const timer = window.setTimeout(finish, 8000);
    return finish;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, active, deg]);
}
