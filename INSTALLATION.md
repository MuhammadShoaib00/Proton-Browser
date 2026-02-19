# 🚀 Secure Browser - Installation Guide

This guide will help you set up and run the Secure Browser on Windows.

## Prerequisites

Before you begin, ensure you have the following installed:

### 1. Node.js (Required)

Download and install Node.js from: https://nodejs.org/

**Recommended**: LTS version (16.x or later)

Verify installation:
```bash
node --version
npm --version
```

### 2. Visual Studio Build Tools (Required for Screenshot Protection)

The native screenshot protection module requires C++ compilation tools.

**Option A: Quick Install (Recommended)**
```bash
npm install --global windows-build-tools
```

**Option B: Manual Install**
1. Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
2. Run the installer
3. Select "Desktop development with C++"
4. Install

### 3. Python (Usually comes with Node.js)

If not installed, download from: https://www.python.org/downloads/

Python 3.7 or later is required.

## Installation Steps

### Quick Setup (Windows)

1. **Open Command Prompt or PowerShell** in the Browser folder

2. **Run the setup script:**
   ```bash
   setup.bat
   ```

   This will automatically:
   - Install all dependencies
   - Build the native screenshot protection module
   - Verify the installation

3. **Run the browser:**
   ```bash
   run.bat
   ```

### Manual Setup

If you prefer to set up manually:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the native module:**
   ```bash
   npm run rebuild
   ```

3. **Start the browser:**
   ```bash
   npm start
   ```

## Verification

After installation, verify screenshot protection is working:

1. Open the Secure Browser
2. Navigate to any website
3. Try taking a screenshot with:
   - Windows Snipping Tool
   - Print Screen key
   - Any screenshot software

**Expected Result**: You should see a black screen or background image instead of the actual browser content.

## Troubleshooting

### Issue: "npm run rebuild" fails

**Solution 1**: Install Visual Studio Build Tools
```bash
npm install --global windows-build-tools
```

**Solution 2**: Install Python if missing
- Download from python.org
- Add to PATH during installation

**Solution 3**: Run as Administrator
- Right-click Command Prompt
- Select "Run as Administrator"
- Try again

### Issue: Screenshot protection not working

**Possible Causes**:
1. Windows version too old (need Build 17134+)
2. Native module didn't build correctly
3. Antivirus blocking the application

**Solutions**:
1. Check Windows version: `winver`
2. Rebuild: `npm run rebuild`
3. Add exception in antivirus
4. Check console for error messages

### Issue: "Module not found" error

**Solution**: Reinstall dependencies
```bash
rm -rf node_modules
npm install
npm run rebuild
```

### Issue: Electron fails to start

**Solution**: Clear cache and reinstall
```bash
npm cache clean --force
npm install
```

### Issue: Webview not loading pages

**Causes**:
1. No internet connection
2. Firewall blocking
3. Proxy settings

**Solutions**:
1. Check internet connectivity
2. Configure firewall to allow Electron
3. Set proxy in code if needed

## Building for Distribution

To create an executable installer:

```bash
npm run build
```

The installer will be created in the `dist/` folder.

You can distribute this installer to other computers without requiring Node.js or build tools.

## System Requirements

### Minimum:
- **OS**: Windows 10 (Build 17134 or later) or Windows 11
- **RAM**: 4 GB
- **Disk Space**: 500 MB
- **Internet**: Required for browsing

### Recommended:
- **OS**: Windows 11
- **RAM**: 8 GB or more
- **Disk Space**: 1 GB
- **Internet**: Broadband connection

## Security Notes

### What is Protected:
✅ Screenshots (Snipping Tool, Print Screen, third-party tools)
✅ Screen recordings (OBS, Camtasia, etc.)
✅ Monitoring software (Time Doctor, Hubstaff, etc.)
✅ Windows screen capture APIs

### What is NOT Protected:
❌ Physical cameras pointing at screen
❌ Hardware capture devices
❌ Some system-level tools with admin privileges
❌ Remote desktop viewing (depends on implementation)

## Performance Tips

1. **Close unused tabs** - Each tab uses memory
2. **Clear cache regularly** - Settings → Clear Cache
3. **Disable extensions** if not needed
4. **Keep browser updated** - Check for updates regularly

## First Run Checklist

- [ ] Node.js installed and working
- [ ] Visual Studio Build Tools installed
- [ ] Dependencies installed (`npm install`)
- [ ] Native module built successfully (`npm run rebuild`)
- [ ] Browser starts without errors (`npm start`)
- [ ] Can navigate to websites
- [ ] Screenshot protection verified (test with Snipping Tool)
- [ ] No console errors

## Getting Help

If you encounter issues:

1. Check the troubleshooting section above
2. Review error messages in console
3. Ensure all prerequisites are met
4. Try running as Administrator
5. Check Windows version compatibility

## Next Steps

After successful installation:

1. Read the main [README.md](README.md) for features and usage
2. Customize settings in `main.js` if needed
3. Add your favorite bookmarks
4. Enjoy private, protected browsing!

---

**Need Help?** Create an issue with:
- Your Windows version (`winver`)
- Node.js version (`node --version`)
- Complete error message
- Steps you've already tried

