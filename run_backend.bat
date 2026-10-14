@echo off
cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
python run_servers.py --reload
pause
