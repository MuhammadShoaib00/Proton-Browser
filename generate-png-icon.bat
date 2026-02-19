@echo off
echo ========================================
echo Proton Browser - Generate PNG Icon
echo ========================================
echo.
echo The logo.svg has been updated with the new atomic design!
echo.
echo Choose your method:
echo.
echo 1. Install Sharp and Auto-Generate (Recommended)
echo 2. Open HTML Generator
echo 3. Use Online Converter
echo.
set /p choice="Enter choice (1-3): "

if "%choice%"=="1" goto auto
if "%choice%"=="2" goto html
if "%choice%"=="3" goto online
goto end

:auto
echo.
echo Installing Sharp converter...
call npm install sharp
echo.
echo Converting SVG to PNG...
call node convert-icon.js
echo.
echo Done! PNG icon created at: assets\logo.png
echo.
echo Now launching browser...
timeout /t 2
call npm start
goto end

:html
echo.
echo Opening HTML icon generator...
start create-icon.html
echo.
echo Instructions:
echo 1. Click "256x256 (Main)" button
echo 2. Right-click the canvas
echo 3. Save as: assets\logo.png
echo.
pause
goto end

:online
echo.
echo Opening browser for online conversion...
echo.
echo Go to: https://cloudconvert.com/svg-to-png
echo.
echo Steps:
echo 1. Upload: assets\logo.svg
echo 2. Set size to 256x256
echo 3. Download and save as: assets\logo.png
echo.
start https://cloudconvert.com/svg-to-png
pause
goto end

:end
echo.
echo ========================================
echo After creating logo.png, run: npm start
echo ========================================
pause

