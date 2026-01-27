@echo off
setlocal

cd /d %~dp0

if not exist node_modules (
  echo Instalando dependencias...
  npm install
)

if not exist dist mkdir dist

echo Gerando executavel...
cmd /c "npx pkg . --targets node18-win-x64 --output dist\\paredao.exe"

if exist dist\paredao.exe (
  echo Executavel gerado em dist\paredao.exe
) else (
  echo Falha ao gerar o executavel.
)

pause
endlocal
