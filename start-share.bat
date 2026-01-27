@echo off
setlocal

REM Inicia o servidor Node
start "Paredao Server" cmd /k "cd /d %~dp0 && npm run dev"

REM Aguarda 2 segundos para o servidor subir
timeout /t 2 /nobreak > nul

REM Inicia o Cloudflare Tunnel
start "Cloudflare Tunnel" cmd /k "cd /d %~dp0 && cloudflared tunnel --url http://localhost:3000"

endlocal
