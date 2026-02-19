@echo off
echo ========================================
echo INDUS Browser - Icon Fix
echo ========================================
echo.
echo Installing icon converter...
call npm install sharp --save
echo.
echo Converting SVG to PNG...
call node convert-icon.js
echo.
echo ========================================
echo Icon created! Starting browser...
echo ========================================
timeout /t 2
call npm start

