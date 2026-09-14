@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ITCO Work Shift & Teams Dashboard

echo === Запуск ITCO Work Shift & Teams Dashboard ===
python run.py %*
if errorlevel 1 (
    echo.
    echo ❌ Произошла ошибка при запуске. Убедитесь, что установлены Python и Node.js.
    pause
)
