# Stage 1: Build frontend and install Huly client dependencies
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

WORKDIR /app/backend/huly_client
COPY backend/huly_client/package*.json ./
RUN npm install --omit=dev

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app

# Install system utilities + tzdata + Chromium for Teams headless auth
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tzdata \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js runtime for Huly bridge
COPY --from=frontend-builder /usr/local/bin/node /usr/local/bin/node

# Install python dependencies (skip playwright browser download since system chromium is installed)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/backend/requirements.txt


# Copy application files
COPY run.py /app/run.py
COPY backend/app /app/backend/app
COPY backend/huly_bridge.cjs /app/backend/huly_bridge.cjs
COPY backend/huly_client /app/backend/huly_client
COPY --from=frontend-builder /app/backend/huly_client/node_modules /app/backend/huly_client/node_modules
COPY backend/dashboard.db* /app/backend/
COPY backend/named_chats.example.json /app/backend/named_chats.example.json
COPY backend/named_chats.json* /app/backend/
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Ensure persistence directories + attachments directory + empty chats cache
RUN mkdir -p /app/data /app/backend/media/attachments && touch /app/backend/teams_chats_cache.json

EXPOSE 8000

ENV PYTHONUNBUFFERED=1
ENV TZ=Europe/Moscow
ENV APP_TIMEZONE=Europe/Moscow

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
