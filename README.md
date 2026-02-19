# 🚀 INDUS Browser

**Ultra-Fast • Secure • Screenshot Protected**

A blazing-fast, privacy-focused web browser built with Electron.js that prevents third-party applications from taking screenshots or recording your screen. INDUS Browser combines cutting-edge performance with military-grade screenshot protection, making it perfect for protecting sensitive information from monitoring software like Time Doctor, screen recorders, and screenshot tools.

## ✨ Features

- **🛡️ Screenshot Protection**: Military-grade Windows API protection prevents all screen capture
- **⚡ Ultra-Fast Performance**: Optimized Chromium engine with GPU acceleration
- **🚫 Smart Ad Blocker**: Enhanced ad & tracker blocking for faster page loads
- **🌐 Full Browser Functionality**: Advanced tab management, navigation, and more
- **🎨 Beautiful INDUS UI**: Stunning purple-gradient design with smooth animations
- **🔐 Privacy First**: No tracking, no data collection, complete privacy
- **💜 Custom Branding**: Unique INDUS logo and color scheme

## 🔐 How Screenshot Protection Works

The browser uses multiple layers of protection:

1. **SetWindowDisplayAffinity (WDA_EXCLUDEFROMCAPTURE)**: Windows API that prevents the window from appearing in screenshots and screen recordings
2. **DWM Attributes**: Additional window attributes for enhanced protection
3. **Electron's Content Protection**: Built-in Electron API for content protection

When this protection is active:
- Windows Snipping Tool will show a black screen
- Screen recording software will capture only a black window or background image
- Time Doctor and similar monitoring tools cannot capture the browser content
- Print Screen will not capture the browser window

## 📋 Requirements

- **Windows 10** (Build 17134 or later) or **Windows 11**
- **Node.js** 16 or later
- **npm** or **yarn**
- **Python** (for building native modules)
- **Visual Studio Build Tools** (for compiling C++ addon)

## 🚀 Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Build Tools (if not already installed)

You need Visual Studio Build Tools for compiling the native C++ addon:

```bash
npm install --global windows-build-tools
```

Or install manually:
- Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)
- Select "Desktop development with C++" workload

### 3. Build Native Module

```bash
npm run rebuild
```

This compiles the C++ addon that provides screenshot protection functionality.

### 4. Run the Application

```bash
npm start
```

## 🏗️ Building for Distribution

To create an installer:

```bash
npm run build
```

This will create an executable installer in the `dist` folder.

## 📁 Project Structure

```
Browser/
├── src/
│   └── screen-protection.cc    # Native C++ module for screenshot protection
├── assets/
│   └── icon.png                # Application icon
├── main.js                     # Electron main process
├── preload.js                  # Preload script for IPC communication
├── renderer.js                 # Browser UI logic and tab management
├── index.html                  # Main HTML structure
├── styles.css                  # Application styles
├── package.json                # Project configuration
├── binding.gyp                 # Native module build configuration
└── README.md                   # This file
```

## 🔧 Configuration

### Modifying Screenshot Protection

The screenshot protection can be configured in `main.js`:

```javascript
screenProtection.setScreenProtection(hwndValue, true);
```

Set the second parameter to `false` to disable protection (not recommended).

### Customizing Ad Blocker

Edit the `adDomains` array in `main.js` to add more domains to block:

```javascript
const adDomains = ['doubleclick.net', 'googlesyndication.com', 'adservice.google.com'];
```

## 🧪 Testing Screenshot Protection

To verify the protection is working:

1. Open the browser
2. Navigate to any website
3. Try to take a screenshot using:
   - Windows Snipping Tool
   - Print Screen key
   - Third-party screenshot tools (ShareX, Greenshot, etc.)
   - Screen recording software (OBS, Camtasia, etc.)

You should see a black window or background image instead of the actual browser content.

## ⚠️ Known Limitations

- **Windows Only**: Screenshot protection currently works only on Windows 10 (Build 17134+) and Windows 11
- **Hardware Capture**: Cannot prevent physical camera recording or hardware capture devices
- **Admin Tools**: Some system-level tools with elevated privileges may bypass protection
- **Compatibility**: May not work with some remote desktop or virtualization software

## 🛠️ Troubleshooting

### Native Module Build Fails

If the native module fails to build:

1. Ensure Visual Studio Build Tools are installed
2. Make sure Python is in your PATH
3. Try running with administrator privileges
4. Check Node.js version compatibility

### Screenshot Protection Not Working

1. Verify Windows version (Build 17134 or later required)
2. Check console for error messages
3. Rebuild the native module: `npm run rebuild`
4. Ensure no antivirus is blocking the application

### Webview Not Loading

If websites don't load:

1. Check your internet connection
2. Look for console errors
3. Try disabling ad blocker temporarily
4. Clear browser cache

## 📝 Development

### Debug Mode

To enable DevTools:

In `main.js`, add:

```javascript
mainWindow.webContents.openDevTools();
```

### Hot Reload

For development with auto-reload, install `electron-reload`:

```bash
npm install --save-dev electron-reload
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## ⚡ Performance Tips

- Close unused tabs to save memory
- Disable ad blocker for trusted sites if needed
- Clear cache regularly
- Keep the application updated

## 🔒 Security Notes

This browser provides **content protection**, not complete security. Always use:
- Strong passwords
- Two-factor authentication
- VPN for sensitive activities
- Up-to-date antivirus software

## 🆘 Support

If you encounter any issues:

1. Check the troubleshooting section
2. Review console logs
3. Create an issue on GitHub with details about your system and the problem

## 🎯 Future Features

- [ ] macOS and Linux support
- [ ] Built-in VPN
- [ ] Password manager
- [ ] Bookmark sync
- [ ] Extensions support
- [ ] Custom themes
- [ ] Advanced privacy settings

---

**Note**: This browser is designed for privacy and protection from screen capture. It should be used responsibly and in compliance with your organization's policies and local laws.

