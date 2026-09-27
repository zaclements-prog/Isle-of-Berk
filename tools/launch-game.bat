@echo off
rem ---- Isle of Berk launcher: serve dist/ on :8750 and open the game
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-dist.ps1"
