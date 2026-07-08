@echo off
title Financeiro Pessoal
cd /d "%~dp0"
start "" "http://localhost:3345"
node --no-warnings server.js
pause
