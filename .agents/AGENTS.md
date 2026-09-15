# Agent Operating Guidelines - ITCO Dashboard

## 1. Project Overview & Architecture
ITCO Dashboard is a web application for work shift tracking, real-time earnings calculation, and automated status reporting to Microsoft Teams (manager greeting & daily team reports).
- **Backend**: FastAPI (Python 3.12), SQLite (`aiosqlite`), Playwright, HTTPX.
- **Frontend**: React 18, Vite 6, TypeScript, Tailwind CSS, Refero Minimalist Design.
- **Deployment**: Docker Compose, Nginx SSL reverse proxy, GitHub Actions manual deploy (`workflow_dispatch`).

## 2. Invariants & Rules
1. **NEVER SEND REAL TEAMS MESSAGES**:
   - Do NOT trigger live Microsoft Teams notifications or messages during testing/dev.
   - All network Teams calls must remain mocked in `backend/tests/test_backend.py`.
2. **Salary & Shift Math**:
   - Fixed rate: 35,000 ₽ / month = 1,667.00 ₽ / 8h day (~0.05788 ₽/s).
   - Arrival before 10:00:00 is rounded to 10:00:00.
   - Shift end time is rounded up in employee's favor to nearest full hour (e.g., 17:31 -> 18:00, 19:05 -> 19:00).
   - Overtime above 8.0h is paid proportionally.
3. **No AI Slop / Clean UI**:
   - Maintain Refero design style: clean light slate theme, `border-slate-200/80`, `tabular-nums` for timers and monetary amounts.
   - No bouncy `scale()` animations or floating popups.
4. **Security & Deployment**:
   - Never commit `.env` or sensitive credentials.
   - `docker-compose.yml` port is bound to `127.0.0.1:8000:8000`.
   - Deployment is strictly manual via GitHub Actions workflow `Deploy to VPS` (`workflow_dispatch`).

## 3. Key Commands
- Run backend tests: `python -m unittest discover backend/tests`
- Build frontend: `cd frontend && npm run build && cd ..`
- Run locally: `python run.py` (or `python run.py --dev`)
- Docker build: `docker compose up -d --build`
