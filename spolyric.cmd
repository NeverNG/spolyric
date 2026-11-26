@echo off
setlocal
rem Spolyric launcher for Windows: spolyric.cmd run / status / login / logout / config
node "%~dp0dist\src\main.js" %*
exit /b %ERRORLEVEL%
