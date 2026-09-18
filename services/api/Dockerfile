FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY tests ./tests
COPY alembic.ini .
COPY pytest.ini .

EXPOSE 8000
# --no-access-log: uvicorn's default access logger writes the full request line to
# stdout on every request. chat_ws's auth token no longer rides in the URL (it moved to
# a post-connect frame -- see app/routers/chat.py's chat_ws docstring), so this is no
# longer covering an active credential leak, but app/main.py's own structured
# correlation-id logging already covers request visibility without ever logging a query
# string, so there's no reason to turn the noisier default back on.
#
# --ws-max-size: a real, deliberate protocol-level cap (1 MiB) on a single WebSocket
# frame, well above app/routers/chat.py's own MAX_USER_MESSAGE_CHARS (50,000 chars of
# actual message content plus JSON framing overhead), so an oversized frame is rejected
# by the WebSocket layer itself -- before it's even parsed into a frame dict -- rather
# than relying on uvicorn's own undocumented default.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--ws-max-size", "1048576"]
