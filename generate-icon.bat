@echo off
echo ========================================
echo INDUS Browser - Icon Generator
echo ========================================
echo.
echo Opening icon generator in your browser...
echo.
echo Instructions:
echo 1. Click "256x256 (Main)" button
echo 2. Right-click the canvas
echo 3. Select "Save Image As..."
echo 4. Save as: assets\logo.png
echo.
echo The page will open now...
timeout /t 3
start create-icon.html
echo.
echo After saving logo.png, restart the browser with: npm start
echo.
pause

