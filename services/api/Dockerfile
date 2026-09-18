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
# --no-access-log: uvicorn's default access logger writes the full request line
# (method + path + query string) to stdout on every request, including the WebSocket
# handshake -- and app/routers/chat.py's chat_ws currently authenticates via a `?token=`
# query parameter (see openChatSocket in apps/desktop/src/api.ts), so the default access
# log would put every student's raw JWT in plaintext in this container's logs on every
# chat connection. This stops that leak immediately; app/main.py's own structured
# request logging (which does NOT log query strings) still covers request visibility.
# The real, complete fix is moving that token out of the URL entirely (a post-connect
# auth frame instead) -- tracked separately; this flag is the safe stopgap.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
