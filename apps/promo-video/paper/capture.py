"""Real-backend capture for the research film (an arXiv-style paper from scratch notes and a
synopsis). Runs INSIDE the api container (`docker exec -i -w /app newton2-api-1 python - <stage>`
with this file on stdin; the two source documents are copied to /tmp/paper_src first).
Nothing here writes Newton's words: it uploads real files as the dev student, holds a real chat
over the real WS protocol, lets Newton plan, revise and WRITE the paper (real research, real
LaTeX compile), and records everything it does.

The account is snapshotted and restored: student1 is switched to Pro (the paper writer is Pro
only), Focus Mode off and Learn Mode off (the paper writer is blocked by both), and given a
display name so the paper carries an author. `restore` puts it all back.

Stages (state persists in /tmp/paper_state.json):
  setup                              upload notes + synopsis, snapshot + set account flags
  say <base64 text> [--attach] [--timeout N]   one student message (--attach adds the synopsis)
  review [--timeout N]               re-upload the finished PDF and two more real turns: attach +
                                      review it, then highlight a passage and ask about it
  fetch-paper                        find the generated PDF/.tex, save them to /tmp/paper_out
  truncate <n>                       delete turn n (0-based, a user message) and everything after
  show | dump
  restore [--delete-docs]
"""
import asyncio
import base64
import json
from datetime import datetime, timezone
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
STATE = "/tmp/paper_state.json"
SRC = "/tmp/paper_src"
NOTES = ("SOR_scratch_notes.md", "text/markdown")
SYNOPSIS = (
    "Synopsis_SOR_Poisson.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
)
AUTHOR = "Priya Nair"


def load():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save(s):
    json.dump(s, open(STATE, "w"), indent=1)


async def token():
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            f"{KC}/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": "newton-api", "username": "student1", "password": "newton-dev"},
        )
        r.raise_for_status()
        return r.json()["access_token"]


async def set_flags(sub, plan, focus, learn, display_name):
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.keycloak_sub == sub))).scalar_one()
        orig = {
            "plan": u.plan,
            "focus": u.focus_mode_enabled,
            "learn": u.learn_mode_enabled,
            "display_name": u.display_name,
        }
        u.plan, u.focus_mode_enabled, u.learn_mode_enabled, u.display_name = plan, focus, learn, display_name
        await db.commit()
        return orig


async def stage_setup(orig_override=None):
    tok = await token()
    sub = jose_jwt.get_unverified_claims(tok)["sub"]
    s = load()
    orig = await set_flags(sub, "pro", False, False, AUTHOR)
    if orig_override:
        # the account's real settings, when the state file was lost (a rebuilt container) and the
        # flags read just now are already the capture's
        s["orig"] = orig_override
    elif "orig" not in s:
        s["orig"] = orig
    s["sub"] = sub
    s["docs"] = {}
    # before the uploads, so `restore --delete-docs` removes them too
    s["started"] = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient(timeout=90) as c:
        h = {"Authorization": f"Bearer {tok}"}
        # leftovers of an earlier run of this capture would be duplicates in the Documents list
        mine = {NOTES[0], SYNOPSIS[0]}
        for d in (await c.get(f"{API}/documents", headers=h)).json():
            if d["filename"] in mine:
                await c.delete(f"{API}/documents/{d['id']}", headers=h)
                print("removed leftover", d["filename"])
        for key, (name, mime) in (("notes", NOTES), ("synopsis", SYNOPSIS)):
            raw = open(f"{SRC}/{name}", "rb").read()
            r = await c.post(f"{API}/documents/upload", headers=h, files={"file": (name, raw, mime)})
            r.raise_for_status()
            doc = r.json()
            content = (await c.get(f"{API}/documents/{doc['id']}/content", headers=h)).json()
            s["docs"][key] = {"doc": doc, "content": content["content"]}
            print("UPLOADED", key, doc["id"], doc["filename"], len(content["content"]), "chars")
        s["doc_list"] = (await c.get(f"{API}/documents", headers=h)).json()
    s["turns"] = []
    s.pop("session", None)
    save(s)
    print("ORIG", s["orig"])


async def send_message(s, tok, text, timeout):
    """One real turn over the real WS chat protocol: sends `text` as the student, waits
    for the "done" frame, and appends the (user, assistant) pair to `s["turns"]` -- the
    one thing every stage that talks to the tutor shares (stage_say, stage_review)."""
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=30) as c:
        if "session" not in s:
            r = await c.post(f"{API}/chat/sessions", headers=h)
            r.raise_for_status()
            s["session"] = r.json()["session_id"]
    frames = []
    async with websockets.connect(
        f"{WS}/chat/ws/{s['session']}", max_size=16_000_000, ping_interval=20, ping_timeout=None
    ) as ws:
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
    tools = [
        {"type": f["type"], "tool": f.get("tool"), "label": f.get("label"), "verified": f.get("verified")}
        for f in frames
        if str(f.get("type", "")).startswith("tool")
    ]
    s["turns"].append({"role": "user", "content": text})
    s["turns"].append({"role": "assistant", "content": reply, "tools": tools})
    save(s)
    print("TOOLS", json.dumps(tools))
    print("REPLY_BEGIN")
    print(reply)
    print("REPLY_END")


async def stage_say(text, attach, timeout):
    s = load()
    tok = await token()
    if attach:
        # both source documents ride along on the one message: the synopsis, then the lab notes
        marks = [
            f"[Attached document: {s['docs'][k]['doc']['id']}|{s['docs'][k]['doc']['filename']}]"
            for k in ("synopsis", "notes")
        ]
        text = f"{text}\n\n" + "\n".join(marks)
    await send_message(s, tok, text, timeout)


async def stage_review(timeout):
    """Two more real turns, continuing the SAME session, for the DocumentViewerPanel
    scene: `restore --delete-docs` removed the finished PDF from Documents, so it's
    re-uploaded here (the exact same bytes generated earlier -- see run_cap.sh's
    `stage-pdf`) before the student can attach it again. Turn A attaches it and opens a
    review; turn B is the "highlight -> Ask Newton" quote-and-follow-up, with no new
    attachment (the document is already the one being discussed)."""
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    import glob

    pdf_path = glob.glob(f"{SRC}/*.pdf")[0]
    filename = os.path.basename(pdf_path)
    async with httpx.AsyncClient(timeout=60) as c:
        # a leftover from an earlier (truncated/retried) run of this same stage
        for d in (await c.get(f"{API}/documents", headers=h)).json():
            if d["filename"] == filename:
                await c.delete(f"{API}/documents/{d['id']}", headers=h)
                print("removed leftover reupload", d["id"])
        raw = open(pdf_path, "rb").read()
        r = await c.post(f"{API}/documents/upload", headers=h, files={"file": (filename, raw, "application/pdf")})
        r.raise_for_status()
        doc = r.json()
        s["docs"]["paper_reupload"] = {"doc": doc}
        save(s)
        print("REUPLOADED", doc["id"], doc["filename"])

    # Specific, paper-vocabulary wording -- this shared dev account has a lot of OTHER
    # documents in it from unrelated test runs, and a generic "what does Table 3 show"
    # embeds too close to some of those; naming the actual quantities (measured vs.
    # predicted SOR iteration counts, spectral radius) is what reliably retrieves OUR
    # chunks instead.
    text_a = (
        "Now that it's written, I want to go through the results with you -- attaching the finished "
        "PDF so we're both looking at the same thing. Table 3 has the measured-vs-predicted SOR "
        "iteration counts against the classical spectral-radius prediction -- can you walk me "
        "through what it shows?"
        f"\n\n[Attached document: {doc['id']}|{doc['filename']}]"
    )
    await send_message(s, tok, text_a, timeout)

    quote = (
        "The SOR prediction is less satisfactory: the measured count exceeds the asymptotic "
        "prediction by roughly 30\u201337% on these grids."
    )
    text_b = (
        f'Regarding this part of "{doc["filename"]}":\n> {quote}\n\n'
        "Is that 30-37% roughly consistent across all three grid sizes, or does it grow with n?"
    )
    await send_message(s, tok, text_b, timeout)


async def stage_fetch_paper():
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    os.makedirs("/tmp/paper_out", exist_ok=True)
    async with httpx.AsyncClient(timeout=120) as c:
        docs = (await c.get(f"{API}/documents", headers=h)).json()
        made = [d for d in docs if d["filename"].lower().endswith((".pdf", ".tex")) and d["id"] not in
                [x["doc"]["id"] for x in s["docs"].values()]]
        made.sort(key=lambda d: d["created_at"], reverse=True)
        out = {}
        for d in made[:2]:
            raw = await c.get(f"{API}/documents/{d['id']}/raw", headers=h)
            raw.raise_for_status()
            path = f"/tmp/paper_out/{d['filename']}"
            open(path, "wb").write(raw.content)
            content = (await c.get(f"{API}/documents/{d['id']}/content", headers=h)).json()
            out[d["filename"]] = {"doc": d, "bytes": len(raw.content), "content": content.get("content", "")}
            if d.get("has_bibliography"):
                bib = await c.get(f"{API}/documents/{d['id']}/bibliography.bib", headers=h)
                if bib.status_code == 200:
                    open("/tmp/paper_out/refs.bib", "wb").write(bib.content)
                    out[d["filename"]]["bib_bytes"] = len(bib.content)
        s["paper"] = out
        s["doc_list_after"] = docs
        save(s)
    print("PAPER", json.dumps(out, indent=1))


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
    await set_flags(sub, o["plan"], o["focus"], o["learn"], o["display_name"])
    print("RESTORED", o)
    if delete_docs:
        async with httpx.AsyncClient(timeout=30) as c:
            h = {"Authorization": f"Bearer {tok}"}
            # everything created since setup: the uploads, research reports, the paper itself
            ids = [
                d["id"]
                for d in (await c.get(f"{API}/documents", headers=h)).json()
                if d["created_at"] >= s.get("started", "9999")
            ]
            for d in dict.fromkeys(ids):
                r = await c.delete(f"{API}/documents/{d}", headers=h)
                print("deleted", d, r.status_code)


def main():
    a = sys.argv[1:]
    if not a:
        return
    if a[0] == "setup":
        asyncio.run(stage_setup(json.loads(a[a.index("--orig") + 1]) if "--orig" in a else None))
    elif a[0] == "say":
        timeout = int(a[a.index("--timeout") + 1]) if "--timeout" in a else 300
        asyncio.run(stage_say(base64.b64decode(a[1]).decode("utf-8"), "--attach" in a, timeout))
    elif a[0] == "review":
        timeout = int(a[a.index("--timeout") + 1]) if "--timeout" in a else 300
        asyncio.run(stage_review(timeout))
    elif a[0] == "fetch-paper":
        asyncio.run(stage_fetch_paper())
    elif a[0] == "truncate":
        asyncio.run(stage_truncate(int(a[1])))
    elif a[0] == "show":
        stage_show()
    elif a[0] == "restore":
        asyncio.run(stage_restore("--delete-docs" in a))
    elif a[0] == "dump":
        print(open(STATE).read())


main()
