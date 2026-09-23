"""Real-backend capture for the showcase film (integration by parts). Runs INSIDE the api container
(`docker exec -i -w /app newton2-api-1 python - <stage> [args]` with this file on stdin, and
the handout at /tmp/handout.docx). Nothing here writes Newton's words: it uploads a real deck as
student1, opens a real chat session, sends the student's scripted messages over the real WS
protocol, and records what the real backend answers.

Account state is snapshotted and restored: student1 is switched to Pro (artifact builds are
Pro-gated), Focus Mode off (create_artifact refuses under Focus Mode) and Learn Mode ON (the
real "teach me, don't tell me" toggle), then put back by the `restore` stage.

Stages (state persists in /tmp/eng_state.json):
  setup                upload deck, snapshot + set account flags
  say <base64 text> [--attach] [--timeout N]   send one student message, record the reply
                       (run_cap.sh base64-encodes the text so any characters survive ssh)
  artifact-html        fetch the built artifact's HTML (from the last newton-artifact block)
  truncate <n>         delete turn n (0-based, a user message) and everything after it
  show                 print the conversation so far
  restore [--delete-docs]   restore account flags (and optionally delete uploaded docs)
"""
import asyncio
import json
import os
import sys

import httpx
import websockets

sys.path.insert(0, ".")
from jose import jwt as jose_jwt  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db.base import SessionLocal  # noqa: E402
from app.db.models import User  # noqa: E402

API = "http://localhost:8000"
WS = "ws://localhost:8000"
KC = os.environ.get("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080/realms/newton")
STATE = "/tmp/show_state.json"
DECK = "/tmp/handout.docx"
DECK_NAME = "MATH1220_Lecture12_Integration_By_Parts.docx"
DECK_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def load():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save(s):
    json.dump(s, open(STATE, "w"), indent=1)


async def token():
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{KC}/protocol/openid-connect/token", data={
            "grant_type": "password", "client_id": "newton-api", "username": "student1", "password": "newton-dev"})
        r.raise_for_status()
        return r.json()["access_token"]


async def set_flags(sub, plan, focus, learn):
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.keycloak_sub == sub))).scalar_one()
        orig = {"plan": u.plan, "focus": u.focus_mode_enabled, "learn": u.learn_mode_enabled}
        u.plan, u.focus_mode_enabled, u.learn_mode_enabled = plan, focus, learn
        await db.commit()
        return orig


async def stage_setup():
    tok = await token()
    sub = jose_jwt.get_unverified_claims(tok)["sub"]
    s = load()
    orig = await set_flags(sub, "pro", False, True)
    if "orig" not in s:
        s["orig"] = orig
    s["sub"] = sub
    async with httpx.AsyncClient(timeout=60) as c:
        h = {"Authorization": f"Bearer {tok}"}
        raw = open(DECK, "rb").read()
        r = await c.post(f"{API}/documents/upload", headers=h, files={
            "file": (DECK_NAME, raw, DECK_MIME)})
        r.raise_for_status()
        doc = r.json()
        s["doc"] = doc
        s.setdefault("extra_docs", [])
        c2 = await c.get(f"{API}/documents/{doc['id']}/content", headers=h)
        s["doc_content"] = c2.json()
        lst = await c.get(f"{API}/documents", headers=h)
        s["doc_list"] = lst.json()
    s["turns"] = []
    s.pop("session", None)
    save(s)
    print("UPLOADED", json.dumps(s["doc"]))
    print("CONTENT_HEAD", s["doc_content"]["content"][:600].replace("\n", " | "))
    print("ORIG", s["orig"])


async def stage_say(text, attach, timeout):
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    if attach:
        text = f"{text}\n\n[Attached document: {s['doc']['id']}|{s['doc']['filename']}]"
    async with httpx.AsyncClient(timeout=30) as c:
        if "session" not in s:
            r = await c.post(f"{API}/chat/sessions", headers=h)
            r.raise_for_status()
            s["session"] = r.json()["session_id"]
    frames = []
    async with websockets.connect(f"{WS}/chat/ws/{s['session']}", max_size=16_000_000, ping_interval=20, ping_timeout=None) as ws:
        await ws.send(json.dumps({"type": "auth", "token": tok}))
        ack = json.loads(await asyncio.wait_for(ws.recv(), 15))
        assert ack.get("type") == "auth_ok", ack
        await ws.send(json.dumps({"type": "user_message", "content": text}))
        while True:
            f = json.loads(await asyncio.wait_for(ws.recv(), timeout))
            frames.append(f)
            if f.get("type") == "done":
                break
    reply = "".join(f.get("content", "") for f in frames if f.get("type") == "chunk")
    tools = [{"type": f["type"], "tool": f.get("tool"), "label": f.get("label"), "verified": f.get("verified")}
             for f in frames if str(f.get("type", "")).startswith("tool")]
    other = sorted({f.get("type") for f in frames} - {"chunk", "done", "user_message_saved"} - {t["type"] for t in tools})
    s["turns"].append({"role": "user", "content": text})
    s["turns"].append({"role": "assistant", "content": reply, "tools": tools, "other_frame_types": other})
    save(s)
    print("TOOLS", json.dumps(tools))
    print("OTHER_FRAMES", other)
    print("REPLY_BEGIN")
    print(reply)
    print("REPLY_END")


async def stage_annotate(action, selected, context):
    """The real Notepad highlight-to-act: POST /notes/{id}/annotate, exactly what the Notepad
    window calls, on a real note."""
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=120) as c:
        if "note" not in s:
            r = await c.post(f"{API}/notes", headers=h, json={"title": "Integration by parts — Lecture 12"})
            r.raise_for_status()
            s["note"] = r.json()
        r = await c.post(f"{API}/notes/{s['note']['id']}/annotate", headers=h,
                         json={"selected_text": selected, "context": context, "action": action})
        r.raise_for_status()
        text = r.json()["text"]
    s.setdefault("annotations", []).append({"action": action, "selected": selected, "text": text})
    save(s)
    print("ANNOTATION", action, "|", selected)
    print(text)


async def stage_artifact_html():
    s = load()
    tok = await token()
    reply = next(t["content"] for t in reversed(s["turns"]) if t["role"] == "assistant" and "newton-artifact" in t["content"])
    block = reply.split("```newton-artifact", 1)[1].split("```", 1)[0]
    meta = json.loads(block)
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(f"{API}/documents/{meta['document_id']}/raw", headers={"Authorization": f"Bearer {tok}"})
        r.raise_for_status()
    s["artifact_meta"] = meta
    # The app decodes the raw bytes as UTF-8 (ArtifactBlock's TextDecoder), so do the same.
    s["artifact_html"] = r.content.decode("utf-8", errors="replace")
    s["artifact_has_bad_utf8"] = "�" in s["artifact_html"]
    s.setdefault("extra_docs", [])
    if meta["document_id"] not in s["extra_docs"]:
        s["extra_docs"].append(meta["document_id"])
    save(s)
    print("ARTIFACT", json.dumps(meta), len(r.content), "bytes; invalid utf-8:", s["artifact_has_bad_utf8"])


async def stage_truncate(n):
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=30) as c:
        msgs = (await c.get(f"{API}/chat/sessions/{s['session']}/messages", headers=h)).json()
        target = msgs[n]
        assert target["role"] == "user", target["role"]
        r = await c.delete(f"{API}/chat/sessions/{s['session']}/messages/{target['id']}", headers=h)
        r.raise_for_status()
    s["turns"] = s["turns"][:n]
    save(s)
    print("TRUNCATED to", n, "turns")


def stage_show():
    s = load()
    for i, t in enumerate(s.get("turns", [])):
        print(f"--- [{i}] {t['role']} " + (json.dumps(t.get("tools")) if t.get("tools") else ""))
        print(t["content"])


async def stage_restore(delete_docs):
    s = load()
    tok = await token()
    sub = jose_jwt.get_unverified_claims(tok)["sub"]
    o = s["orig"]
    await set_flags(sub, o["plan"], o["focus"], o["learn"])
    print("RESTORED", o)
    if delete_docs:
        async with httpx.AsyncClient(timeout=30) as c:
            h = {"Authorization": f"Bearer {tok}"}
            if s.get("note"):
                r = await c.delete(f"{API}/notes/{s['note']['id']}", headers=h)
                print("deleted note", r.status_code)
            for d in [s.get("doc", {}).get("id")] + s.get("extra_docs", []):
                if d:
                    r = await c.delete(f"{API}/documents/{d}", headers=h)
                    print("deleted", d, r.status_code)


def main():
    a = sys.argv[1:]
    if not a:
        return
    if a[0] == "setup":
        asyncio.run(stage_setup())
    elif a[0] == "say":
        timeout = int(a[a.index("--timeout") + 1]) if "--timeout" in a else 240
        import base64
        asyncio.run(stage_say(base64.b64decode(a[1]).decode("utf-8"), "--attach" in a, timeout))
    elif a[0] == "annotate":
        import base64
        dec = lambda x: base64.b64decode(x).decode("utf-8")
        asyncio.run(stage_annotate(a[1], dec(a[2]), dec(a[3])))
    elif a[0] == "artifact-html":
        asyncio.run(stage_artifact_html())
    elif a[0] == "truncate":
        asyncio.run(stage_truncate(int(a[1])))
    elif a[0] == "show":
        stage_show()
    elif a[0] == "restore":
        asyncio.run(stage_restore("--delete-docs" in a))
    elif a[0] == "dump":
        print(open(STATE).read())


main()
