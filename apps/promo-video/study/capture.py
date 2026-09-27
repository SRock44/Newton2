"""Real-backend capture for the study-plan film (a Calculus II Midterm 2 packet -> a dated study
plan, flashcards and a practice exam, then a topic-built step-by-step plan). Runs INSIDE the api
container (`docker exec -i -w /app newton2-api-1 python - <stage> [args]` with this file on stdin,
and the packet at /tmp/study_src/). Nothing here writes Newton's words or content: it uploads a
real document as student1, holds a real chat over the real WS protocol, and records what the real
backend generated -- plus what really happens when the student studies it (flashcard reviews are
FSRS-scheduled, an exam is really graded, weak areas are really computed).

Account state is snapshotted and restored: student1 is switched to Pro (start_study_session is
Pro-only), Focus Mode off and Learn Mode off, then put back by `restore`.

Stages (state persists in /tmp/study_state.json):
  clean                              delete the account's study plan items, flashcards, exams, events
  setup                              clean + upload the packet, snapshot + set account flags
  say <base64 text> [--attach] [--timeout N]   one student message, recorded with its tool frames
  fetch [name]                       record the account's study data under `name` (default "after")
  review-cards <ratings e.g. 3,3,1,2,3>   really review that many due cards, recording each response
  take-exam <n_wrong>                submit the newest exam (correct everywhere except n_wrong questions)
  weak                               record weak areas, gamification stats and billing status
  truncate <n> | show | dump | restore [--delete-docs]
"""
import asyncio
import base64
import json
import os
import sys
from datetime import datetime, timezone

import httpx
import websockets

sys.path.insert(0, ".")
from jose import jwt as jose_jwt  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.db.base import SessionLocal  # noqa: E402
from app.db.models import PracticeExamQuestion, User  # noqa: E402

API = "http://localhost:8000"
WS = "ws://localhost:8000"
KC = os.environ.get("KEYCLOAK_INTERNAL_URL", "http://keycloak:8080/realms/newton")
STATE = "/tmp/study_state.json"
SRC = "/tmp/study_src"
PACKET = ("MATH1220_Midterm2_Study_Packet.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document")


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


async def set_flags(sub, plan, focus, learn):
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.keycloak_sub == sub))).scalar_one()
        orig = {"plan": u.plan, "focus": u.focus_mode_enabled, "learn": u.learn_mode_enabled}
        u.plan, u.focus_mode_enabled, u.learn_mode_enabled = plan, focus, learn
        await db.commit()
        return orig


async def stage_clean():
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=60) as c:
        for path, prefix in (
            ("/study-plan", "/study-plan"),
            ("/flashcards", "/flashcards"),
            ("/practice-exams", "/practice-exams"),
            ("/calendar/events", "/calendar/events"),
        ):
            items = (await c.get(f"{API}{path}", headers=h)).json()
            for it in items:
                await c.delete(f"{API}{prefix}/{it['id']}", headers=h)
            print("cleaned", path, len(items))


async def stage_clean_docs():
    """Removes every document except the packet (leftovers of other runs would show in Documents)."""
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=60) as c:
        for d in (await c.get(f"{API}/documents", headers=h)).json():
            if d["filename"] != PACKET[0]:
                r = await c.delete(f"{API}/documents/{d['id']}", headers=h)
                print("removed", d["filename"], r.status_code)


async def stage_setup():
    await stage_clean()
    tok = await token()
    sub = jose_jwt.get_unverified_claims(tok)["sub"]
    s = load()
    orig = await set_flags(sub, "pro", False, False)
    if "orig" not in s:
        s["orig"] = orig
    s["sub"] = sub
    s["started"] = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient(timeout=90) as c:
        h = {"Authorization": f"Bearer {tok}"}
        name, mime = PACKET
        for d in (await c.get(f"{API}/documents", headers=h)).json():
            if d["filename"] == name:
                await c.delete(f"{API}/documents/{d['id']}", headers=h)
                print("removed leftover", d["filename"])
        raw = open(f"{SRC}/packet.docx", "rb").read()
        r = await c.post(f"{API}/documents/upload", headers=h, files={"file": (name, raw, mime)})
        r.raise_for_status()
        doc = r.json()
        content = (await c.get(f"{API}/documents/{doc['id']}/content", headers=h)).json()
        s["doc"] = {"doc": doc, "content": content["content"]}
        s["doc_list"] = (await c.get(f"{API}/documents", headers=h)).json()
        print("UPLOADED", doc["id"], doc["filename"], len(content["content"]), "chars")
    s["turns"] = []
    s.pop("session", None)
    s["captured_at"] = datetime.now(timezone.utc).isoformat()
    save(s)
    print("ORIG", s["orig"])


async def stage_say(text, attach, timeout):
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    if attach:
        text = f"{text}\n\n[Attached document: {s['doc']['doc']['id']}|{s['doc']['doc']['filename']}]"
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
    actions = [f for f in frames if f.get("type") == "suggested_action"]
    s["turns"].append({"role": "user", "content": text})
    s["turns"].append({"role": "assistant", "content": reply, "tools": tools, "suggested_actions": actions})
    save(s)
    print("TOOLS", json.dumps(tools))
    print("ACTIONS", json.dumps(actions))
    print("REPLY_BEGIN")
    print(reply)
    print("REPLY_END")


async def _get(c, h, path):
    r = await c.get(f"{API}{path}", headers=h)
    r.raise_for_status()
    return r.json()


async def stage_fetch(name):
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=60) as c:
        exams = await _get(c, h, "/practice-exams")
        snap = {
            "study_plan": await _get(c, h, "/study-plan"),
            "flashcards": await _get(c, h, "/flashcards"),
            "flashcards_due": await _get(c, h, "/flashcards?due_only=true"),
            "exams": exams,
            "exam_details": {e["id"]: await _get(c, h, f"/practice-exams/{e['id']}") for e in exams},
            "calendar_events": await _get(c, h, "/calendar/events"),
            "documents": await _get(c, h, "/documents"),
        }
    s.setdefault("snapshots", {})[name] = snap
    save(s)
    print("FETCHED", name, {k: (len(v) if hasattr(v, "__len__") else v) for k, v in snap.items()})
    for it in snap["study_plan"]:
        print("  plan:", it["due_date"], "|", it["due_date_text"], "|", it["title"])


async def stage_review_cards(ratings):
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    out = []
    async with httpx.AsyncClient(timeout=60) as c:
        due = await _get(c, h, "/flashcards?due_only=true")
        for card, rating in zip(due, ratings):
            r = await c.post(f"{API}/flashcards/{card['id']}/review", headers=h, json={"rating": rating})
            r.raise_for_status()
            out.append({"before": card, "rating": rating, "after": r.json()})
            print("reviewed", card["front"][:50], "->", rating, "next due", r.json()["due"])
    s["reviews"] = out
    save(s)


async def stage_take_exam(n_wrong):
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=60) as c:
        exams = await _get(c, h, "/practice-exams")
        exam = sorted(exams, key=lambda e: e["created_at"])[-1]
        detail = await _get(c, h, f"/practice-exams/{exam['id']}")
    async with SessionLocal() as db:
        rows = (
            await db.execute(select(PracticeExamQuestion).where(PracticeExamQuestion.exam_id == exam["id"]))
        ).scalars().all()
        correct = {str(r.id): r.correct_index for r in rows}
    # wrong answers spread through the exam (not clustered at the end), the rest right
    order = [q["id"] for q in sorted(detail["questions"], key=lambda q: q["question_index"])]
    # the misses cluster where a student really slips: partial-fraction forms, the right-triangle
    # substitution, and the LIATE choice
    wrong_at = {order[i] for i in [10, 13, 6, 2, 14, 9][:n_wrong] if i < len(order)}
    answers = {qid: (ci + 1) % 4 if qid in wrong_at else ci for qid, ci in correct.items()}
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{API}/practice-exams/{exam['id']}/submit", headers=h, json={"answers": answers})
        r.raise_for_status()
        graded = r.json()
    s["exam_taken"] = {"exam_id": exam["id"], "answers": answers, "graded": graded}
    save(s)
    print("EXAM", exam["title"], "score", graded["score"], "wrong", len(wrong_at))


async def stage_weak():
    s = load()
    tok = await token()
    h = {"Authorization": f"Bearer {tok}"}
    async with httpx.AsyncClient(timeout=60) as c:
        s["weak_areas"] = await _get(c, h, "/weak-areas")
        s["stats"] = await _get(c, h, "/gamification/stats")
        s["billing"] = await _get(c, h, "/billing/status")
        s["flashcards_after"] = await _get(c, h, "/flashcards")
        s["flashcards_due_after"] = await _get(c, h, "/flashcards?due_only=true")
        s["exams_after"] = await _get(c, h, "/practice-exams")
    save(s)
    print("WEAK", json.dumps(s["weak_areas"])[:600])
    print("STATS", json.dumps(s["stats"]))


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
        await stage_clean()
        async with httpx.AsyncClient(timeout=30) as c:
            h = {"Authorization": f"Bearer {tok}"}
            for d in (await c.get(f"{API}/documents", headers=h)).json():
                if d["created_at"] >= s.get("started", "9999"):
                    r = await c.delete(f"{API}/documents/{d['id']}", headers=h)
                    print("deleted", d["filename"], r.status_code)


def main():
    a = sys.argv[1:]
    if not a:
        return
    if a[0] == "clean":
        asyncio.run(stage_clean())
    elif a[0] == "clean-docs":
        asyncio.run(stage_clean_docs())
    elif a[0] == "setup":
        asyncio.run(stage_setup())
    elif a[0] == "say":
        timeout = int(a[a.index("--timeout") + 1]) if "--timeout" in a else 300
        asyncio.run(stage_say(base64.b64decode(a[1]).decode("utf-8"), "--attach" in a, timeout))
    elif a[0] == "fetch":
        asyncio.run(stage_fetch(a[1] if len(a) > 1 else "after"))
    elif a[0] == "review-cards":
        asyncio.run(stage_review_cards([int(x) for x in a[1].split(",")]))
    elif a[0] == "take-exam":
        asyncio.run(stage_take_exam(int(a[1])))
    elif a[0] == "weak":
        asyncio.run(stage_weak())
    elif a[0] == "truncate":
        asyncio.run(stage_truncate(int(a[1])))
    elif a[0] == "show":
        stage_show()
    elif a[0] == "restore":
        asyncio.run(stage_restore("--delete-docs" in a))
    elif a[0] == "dump":
        print(open(STATE).read())


main()
