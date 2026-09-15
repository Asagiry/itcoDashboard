#!/usr/bin/env python3
import os
import sys
import subprocess
import argparse
import webbrowser
import time

if sys.platform == "win32":
    import asyncio
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_LIBS = os.path.join(ROOT_DIR, "backend", "libs")
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
FRONTEND_DIST = os.path.join(FRONTEND_DIR, "dist")

if BACKEND_LIBS not in sys.path:
    sys.path.insert(0, BACKEND_LIBS)

def check_frontend_built():
    return os.path.exists(os.path.join(FRONTEND_DIST, "index.html"))

def build_frontend():
    print("📦 Сборка фронтенда (React + Vite)...")
    res = subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR)
    if res.returncode != 0:
        print("❌ Ошибка при сборке фронтенда!")
        sys.exit(res.returncode)
    print("✅ Фронтенд успешно собран!")

def free_port_if_needed(port: int):
    try:
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) == 0:
                print(f"⚠️ Порт {port} занят, освобождаем...")
                if sys.platform == "win32":
                    res = subprocess.run(["netstat", "-ano", "-p", "tcp"], capture_output=True, text=True)
                    for line in res.stdout.splitlines():
                        if f":{port} " in line and "LISTENING" in line:
                            parts = line.strip().split()
                            if parts:
                                pid = parts[-1]
                                subprocess.run(["taskkill", "/F", "/PID", pid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    subprocess.run(["fuser", "-k", f"{port}/tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(0.6)
    except Exception:
        pass

def main():
    parser = argparse.ArgumentParser(description="ITCO Work Shift & Teams Dashboard Runner")
    parser.add_argument("--dev", action="store_true", help="Запуск в режиме разработки (FastAPI на 8000 + Vite dev на 5173)")
    parser.add_argument("--host", default="127.0.0.1", help="Хост сервера (по умолчанию 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Порт бэкенда (по умолчанию 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Не открывать браузер автоматически")
    args = parser.parse_args()

    free_port_if_needed(args.port)

    # If not dev mode and dist doesn't exist, build frontend
    if not args.dev and not check_frontend_built():
        build_frontend()

    if args.dev:
        print("🚀 Запуск в режиме разработки (Backend + Frontend hot-reload)...")
        env = os.environ.copy()
        env["PYTHONPATH"] = f"{ROOT_DIR}:{BACKEND_LIBS}"

        backend_proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--reload", "--host", args.host, "--port", str(args.port)],
            cwd=ROOT_DIR,
            env=env
        )

        frontend_proc = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=FRONTEND_DIR
        )

        url = "http://localhost:5173"
        print(f"\n✨ Дашборд запущен в dev-режиме: {url}")
        print("Нажмите Ctrl+C для остановки обоих серверов.\n")

        if not args.no_browser:
            time.sleep(1.5)
            webbrowser.open(url)

        try:
            backend_proc.wait()
            frontend_proc.wait()
        except KeyboardInterrupt:
            print("\nОстановка серверов...")
            backend_proc.terminate()
            frontend_proc.terminate()
    else:
        print(f"🚀 Запуск ITCO Dashboard (FastAPI + React SPA) на http://{args.host}:{args.port}...")
        env = os.environ.copy()
        env["PYTHONPATH"] = f"{ROOT_DIR}:{BACKEND_LIBS}"

        url = f"http://{args.host}:{args.port}"
        print(f"\n✨ Дашборд доступен по адресу: {url}")
        print("Нажмите Ctrl+C для завершения работы.\n")

        if not args.no_browser:
            def open_tab():
                time.sleep(1.2)
                webbrowser.open(url)
            import threading
            threading.Thread(target=open_tab, daemon=True).start()

        import uvicorn
        from backend.app.main import app
        uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
