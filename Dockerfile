FROM python:3.12-slim

WORKDIR /app

# Install system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy application files
COPY run.py /app/run.py
COPY backend/app /app/backend/app
COPY backend/dashboard.db /app/backend/dashboard.db
COPY backend/named_chats.json /app/backend/named_chats.json
COPY backend/teams_chats_cache.json /app/backend/teams_chats_cache.json
COPY frontend/dist /app/frontend/dist

# Ensure persistence directories
RUN mkdir -p /app/data

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000", "--no-browser"]
