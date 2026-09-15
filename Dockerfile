# Stage 1: Build frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

# Stage 2: Runtime
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
COPY backend/dashboard.db* /app/backend/
COPY backend/named_chats.example.json /app/backend/named_chats.example.json
COPY backend/named_chats.json* /app/backend/
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Ensure persistence directories + empty chats cache (file may not exist in repo)
RUN mkdir -p /app/data && touch /app/backend/teams_chats_cache.json

EXPOSE 8000

ENV PYTHONUNBUFFERED=1
ENV TZ=Europe/Moscow
ENV APP_TIMEZONE=Europe/Moscow

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
