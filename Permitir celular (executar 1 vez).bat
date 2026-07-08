@echo off
rem Libera a porta 3345 no Firewall do Windows APENAS para redes privadas (sua casa).
rem Execute uma unica vez. Pede permissao de administrador.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Pedindo permissao de administrador...
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="Financeiro Pessoal" >nul 2>&1
netsh advfirewall firewall add rule name="Financeiro Pessoal" dir=in action=allow protocol=TCP localport=3345 profile=private

echo.
echo  =====================================================
echo   Pronto! O celular ja pode acessar o app.
echo   1. Conecte o celular no MESMO Wi-Fi do computador
echo   2. Abra o app pelo "Iniciar Financeiro.bat"
echo   3. No celular, acesse o endereco que aparece
echo      na janela do app (ex.: http://192.168.0.10:3345)
echo.
echo   Dica: no app, clique em "Celular" (canto inferior
echo   esquerdo) para ver o endereco certinho.
echo  =====================================================
echo.
pause
