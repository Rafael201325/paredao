@echo off
setlocal

cd /d %~dp0

if not exist node_modules (
  echo Instalando dependencias...
  npm install
)

set VOTER_SALT=dev-salt-change-me
set PORT=3000

npm run dev

endlocal
