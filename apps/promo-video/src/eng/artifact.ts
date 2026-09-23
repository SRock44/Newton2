import { continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { useEffect } from "react";
import { ARTIFACT_HTML } from "./data";
import type { ArtifactState } from "./timeline";

// The beam artifact is the REAL HTML Newton built in the captured chat, rendered by the REAL
// ArtifactBlock in its real sandboxed iframe. Remotion renders frame by frame, so nothing
// can be clicked with a real mouse; a tiny bridge script is appended to the HTML IN MEMORY
// (never to the stored file) so the composition can set the sliders / press the toggle for
// each frame via postMessage and wait (delayRender) for the artifact to acknowledge that it
// has redrawn. What each frame shows is exactly what the artifact's own code drew.
const BRIDGE = `<script>(function(){
  function rect(id){var e=document.getElementById(id); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left+window.scrollX,y:r.top+window.scrollY,w:r.width,h:r.height};}
  window.addEventListener('message',function(e){
    var d=e.data; if(!d||d.promo!=='set') return;
    var max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    window.scrollTo(0,(d.f||0)*max);
    var inL=document.getElementById('inL'), inP=document.getElementById('inP');
    inL.value=d.L; inP.value=d.P;
    inL.dispatchEvent(new Event('input',{bubbles:true}));
    inP.dispatchEvent(new Event('input',{bubbles:true}));
    var b=document.getElementById(d.mode==='cant'?'btnCant':'btnSimply');
    if(!b.classList.contains('active')) b.click();
    parent.postMessage({promo:'ack',key:d.key,rects:{max:max,btnSimply:rect('btnSimply'),btnCant:rect('btnCant'),inL:rect('inL'),inP:rect('inP')}},'*');
  });
  parent.postMessage({promo:'ready'},'*');
})();</script>`;

const withBridge = ARTIFACT_HTML.includes("</body>")
  ? ARTIFACT_HTML.replace("</body>", BRIDGE + "</body>")
  : ARTIFACT_HTML + BRIDGE;
const bytes = new TextEncoder().encode(withBridge);
export const beamArtifactBytes = async () => bytes;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const beamRects: { valid: boolean; max?: number; btnSimply?: Rect; btnCant?: Rect; inL?: Rect; inP?: Rect } = { valid: false };

/** Sets the artifact's controls for this frame and blocks the render until it has redrawn. */
export function useBeamDrive(active: boolean, state: ArtifactState, onAck: () => void) {
  const frame = useCurrentFrame();
  useEffect(() => {
    if (!active) return;
    const handle = delayRender(`beam artifact @${frame}`);
    let finished = false;
    const iframe = () => document.querySelector<HTMLIFrameElement>(".artifact-block__frame");
    const send = () =>
      iframe()?.contentWindow?.postMessage(
        { promo: "set", key: frame, mode: state.mode, L: state.L, P: state.P, f: state.scroll },
        "*",
      );
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
      if (d.promo === "ack" && d.key === frame) {
        Object.assign(beamRects, d.rects, { valid: true });
        onAck();
        finish();
      }
    };
    window.addEventListener("message", onMsg);
    send();
    // The iframe appears asynchronously and grows the chat pane: keep re-stabilizing (re-pin
    // scroll, force the lazy iframe to load) until the artifact acknowledges this frame.
    const poll = window.setInterval(() => {
      onAck();
      send();
    }, 200);
    const timer = window.setTimeout(finish, 9000);
    return finish;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, active, state.mode, state.L, state.P, state.scroll]);
}

export const assetUrl = (name: string) => staticFile(name);
