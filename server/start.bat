@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title THIS Server

cd /d "%~dp0"

if not exist "node_modules" (
  echo [설치 중] npm install...
  npm install
)

echo [시작] THIS Server...
node server.js
pause
