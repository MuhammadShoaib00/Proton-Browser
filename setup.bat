@echo off
echo ========================================
echo INDUS Browser Setup
echo Ultra-Fast Secure Browser
echo ========================================
echo.

echo Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found: 
node --version
echo.

echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies!
    pause
    exit /b 1
)
echo.

echo Building native module for screenshot protection...
call npm run rebuild
if %errorlevel% neq 0 (
    echo WARNING: Failed to build native module!
    echo Screenshot protection may not work.
    echo.
    echo Make sure you have:
    echo - Visual Studio Build Tools installed
    echo - Python installed and in PATH
    echo.
    echo You can install build tools by running:
    echo npm install --global windows-build-tools
    echo.
    pause
)
echo.

echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Welcome to INDUS Browser!
echo To run the browser, use: npm start
echo Or simply run: run.bat
echo.
pause

