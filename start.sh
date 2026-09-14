#!/usr/bin/env bash
set -e

# Change directory to script's directory
cd "$(dirname "$0")"

echo "=== Запуск ITCO Work Shift & Teams Dashboard ==="

# Если порт 8000 занят старым процессом, освобождаем его
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️ Порт 8000 занят предыдущим процессом, освобождаем..."
    fuser -k 8000/tcp 2>/dev/null || true
    sleep 0.5
fi

python3 run.py "$@"

