@echo off
echo Starting Ideogram 4.0 Local Studio...
echo Opening at http://localhost:8000 in a moment.
echo Press Ctrl+C to stop the server.
echo.
call venv\Scripts\activate.bat
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --log-level info
