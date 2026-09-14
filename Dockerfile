FROM python:3.12-slim

WORKDIR /app

# Install system utilities + tzdata for correct Europe/Moscow time on VPS (UTC host)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Headless Chromium для входа Teams по коду и фонового обновления токена на VPS
# (cdn.playwright.dev из РФ часто недоступен — качаем через зеркало)
ENV PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
RUN python -m playwright install --with-deps chromium

# Copy application files
COPY run.py /app/run.py
COPY backend/app /app/backend/app
COPY backend/dashboard.db /app/backend/dashboard.db
COPY backend/named_chats.json /app/backend/named_chats.json
COPY frontend/dist /app/frontend/dist

# Ensure persistence directories + empty chats cache (file may not exist in repo;
# unconditional COPY of it breaks `docker build` on a fresh clone)
RUN mkdir -p /app/data && touch /app/backend/teams_chats_cache.json

EXPOSE 8000

ENV PYTHONUNBUFFERED=1
ENV TZ=Europe/Moscow
ENV APP_TIMEZONE=Europe/Moscow

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
