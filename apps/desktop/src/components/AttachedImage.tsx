import { useEffect, useState } from "react";
import { API_URL } from "../api";

interface AttachedImageProps {
  token: string;
  sessionId: string;
  imageId: string;
}

/** Fetches a chat-attached image (auth'd, so a plain <img src> won't work) and renders it
 * as a real thumbnail. Attached images are short-lived on the backend (a 2-hour Redis
 * pointer, not a persistent gallery — see app/services/images.py), so older ones will
 * 404; that's expected, and rendered as a clean "no longer available" chip rather than a
 * broken image icon. */
function AttachedImage({ token, sessionId, imageId }: AttachedImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/images/${imageId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("image unavailable");
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, sessionId, imageId]);

  if (failed) {
    return <span className="attached-image-chip attached-image-chip--unavailable">Attached image — no longer available</span>;
  }
  if (!src) {
    return <span className="attached-image-chip attached-image-chip--loading">Loading attached image…</span>;
  }
  return <img className="attached-image-thumb" src={src} alt="Attached to this message" />;
}

export default AttachedImage;
