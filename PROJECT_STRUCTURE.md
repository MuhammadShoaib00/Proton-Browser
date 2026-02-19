# 📁 Project Structure

Complete overview of all files in the Secure Browser project.

## Directory Tree

```
Browser/
├── src/
│   └── screen-protection.cc      # Native C++ module for screenshot protection
├── assets/
│   └── icon.png                  # Application icon (placeholder)
├── main.js                       # Electron main process
├── preload.js                    # Preload script for secure IPC
├── renderer.js                   # Browser UI logic and tab management
├── index.html                    # Main application HTML
├── styles.css                    # Application styles
├── package.json                  # Node.js project configuration
├── binding.gyp                   # Native module build configuration
├── .npmrc                        # npm configuration
├── .gitignore                    # Git ignore rules
├── setup.bat                     # Windows setup script
├── run.bat                       # Quick run script
├── README.md                     # Main documentation
├── QUICKSTART.md                 # Quick start guide
├── INSTALLATION.md               # Detailed installation guide
├── TECHNICAL.md                  # Technical implementation details
└── PROJECT_STRUCTURE.md          # This file
```

## File Descriptions

### Core Application Files

#### `main.js` (Electron Main Process)
- **Purpose**: Main Electron process, window management, screenshot protection initialization
- **Key Functions**:
  - Creates main browser window
  - Loads native screenshot protection module
  - Applies WDA_EXCLUDEFROMCAPTURE flag
  - Sets up session permissions
  - Implements basic ad blocking
  - Handles IPC communication

#### `preload.js` (Preload Script)
- **Purpose**: Secure bridge between main and renderer processes
- **Key Functions**:
  - Exposes safe APIs to renderer via contextBridge
  - Handles tab creation/closing
  - Manages navigation requests

#### `renderer.js` (Browser Logic)
- **Purpose**: Browser UI functionality and tab management
- **Key Components**:
  - `TabManager` class - Manages all tabs
  - Event listeners for navigation controls
  - Webview creation and management
  - Address bar handling
  - URL formatting and validation
  - Tab switching logic
  - Context menu handling

#### `index.html` (UI Structure)
- **Purpose**: Main application HTML structure
- **Contains**:
  - Navigation bar with controls
  - Address bar with security indicator
  - Tabs container
  - Webview container
  - Welcome screen
  - Context menu

#### `styles.css` (Styling)
- **Purpose**: Modern dark-themed UI styling
- **Includes**:
  - Navigation bar styles
  - Tab styles with animations
  - Address bar styling
  - Welcome screen design
  - Context menu styling
  - Responsive design
  - Scrollbar customization

### Native Module Files

#### `src/screen-protection.cc` (C++ Native Addon)
- **Purpose**: Windows API integration for screenshot protection
- **Functions**:
  - `SetScreenProtection()` - Enables/disables protection
  - `GetScreenProtectionStatus()` - Checks current status
- **Windows APIs Used**:
  - `SetWindowDisplayAffinity` - Primary protection
  - `DwmSetWindowAttribute` - Additional DWM protection
  - `DwmEnableBlurBehindWindow` - Blur-behind effect

#### `binding.gyp` (Build Configuration)
- **Purpose**: Configuration for building native C++ addon
- **Specifies**:
  - Source files
  - Include directories
  - Dependencies (node-addon-api)
  - Platform-specific settings
  - Required libraries (user32.lib, dwmapi.lib)

### Configuration Files

#### `package.json` (NPM Configuration)
- **Purpose**: Node.js project configuration
- **Contains**:
  - Project metadata
  - Dependencies (electron, node-gyp, node-addon-api)
  - Scripts (start, build, rebuild)
  - Electron Builder configuration

#### `.npmrc` (NPM Settings)
- **Purpose**: NPM configuration for Windows build
- **Settings**:
  - MSVS version specification
  - Python path configuration

#### `.gitignore` (Git Ignore Rules)
- **Purpose**: Specifies files/folders to exclude from Git
- **Ignores**:
  - node_modules/
  - build/
  - dist/
  - Native compiled files (*.node)
  - IDE files
  - Logs and cache

### Scripts

#### `setup.bat` (Setup Script)
- **Purpose**: Automated setup for Windows
- **Actions**:
  - Checks for Node.js installation
  - Installs npm dependencies
  - Builds native module
  - Displays helpful error messages

#### `run.bat` (Quick Run Script)
- **Purpose**: Quick launcher for the browser
- **Action**: Runs `npm start`

### Documentation Files

#### `README.md` (Main Documentation)
- **Purpose**: Comprehensive project overview
- **Sections**:
  - Features overview
  - How screenshot protection works
  - Requirements
  - Installation instructions
  - Usage guide
  - Troubleshooting
  - Future roadmap

#### `QUICKSTART.md` (Quick Start Guide)
- **Purpose**: Get started in 3 minutes
- **Sections**:
  - Prerequisites
  - Quick setup steps
  - Testing protection
  - Quick tips
  - Common issues

#### `INSTALLATION.md` (Installation Guide)
- **Purpose**: Detailed installation instructions
- **Sections**:
  - Prerequisites with download links
  - Step-by-step installation
  - Verification procedures
  - Comprehensive troubleshooting
  - System requirements
  - Building for distribution

#### `TECHNICAL.md` (Technical Documentation)
- **Purpose**: In-depth technical implementation details
- **Sections**:
  - Architecture diagram
  - Core technologies explained
  - Protection layers
  - Native module implementation
  - What gets blocked/not blocked
  - Performance impact
  - Security considerations
  - Testing procedures

#### `PROJECT_STRUCTURE.md` (This File)
- **Purpose**: Complete project file overview
- **Sections**:
  - Directory tree
  - File descriptions
  - Dependencies
  - Build process

### Assets

#### `assets/icon.png` (Application Icon)
- **Purpose**: Application icon (currently placeholder)
- **Usage**: Displayed in taskbar, window title, installer
- **Note**: Replace with actual icon image

## Dependencies

### Production Dependencies

```json
{
  "node-gyp": "^10.0.1",        // Native addon build tool
  "node-addon-api": "^7.0.0"    // C++ addon API
}
```

### Development Dependencies

```json
{
  "electron": "^28.0.0",        // Electron framework
  "electron-builder": "^24.9.1", // Build/package tool
  "electron-rebuild": "^3.2.9"  // Native module rebuild tool
}
```

### System Dependencies

- **Node.js** (16+): JavaScript runtime
- **Visual Studio Build Tools**: C++ compiler
- **Python** (3.7+): Build scripts
- **Windows 10/11**: Operating system

## Build Process

### Development Build

```bash
npm install          # Install dependencies
npm run rebuild      # Build native module
npm start           # Run application
```

### Production Build

```bash
npm run build       # Create installer in dist/
```

### Build Artifacts

- `build/Release/screen-protection.node` - Compiled native addon
- `dist/` - Production installer (after build)
- `node_modules/` - NPM dependencies

## Key Technologies

### Frontend
- **Electron**: Desktop app framework
- **HTML5/CSS3**: UI structure and styling
- **JavaScript (ES6+)**: Application logic
- **Webview**: Embedded browser engine

### Backend
- **Node.js**: JavaScript runtime
- **N-API**: Native addon API
- **C++17**: Native module language

### Windows APIs
- **user32.dll**: Window management
- **dwmapi.dll**: Desktop Window Manager
- **SetWindowDisplayAffinity**: Screenshot protection
- **DWM Attributes**: Additional protection

## Module Communication

```
┌──────────────┐     IPC      ┌──────────────┐
│   Renderer   │ ←─────────→  │     Main     │
│  (Browser    │              │   (Window    │
│    UI)       │              │  Manager)    │
└──────────────┘              └──────────────┘
                                     │
                                     ↓
                              ┌──────────────┐
                              │   Native     │
                              │   Addon      │
                              │  (C++ DLL)   │
                              └──────────────┘
                                     │
                                     ↓
                              ┌──────────────┐
                              │  Windows API │
                              │  (user32,    │
                              │   dwmapi)    │
                              └──────────────┘
```

## Code Statistics

### Lines of Code (Approximate)

| File                     | Lines | Language   |
|--------------------------|-------|------------|
| main.js                  | ~80   | JavaScript |
| renderer.js              | ~350  | JavaScript |
| preload.js               | ~10   | JavaScript |
| index.html               | ~120  | HTML       |
| styles.css               | ~450  | CSS        |
| screen-protection.cc     | ~120  | C++        |
| **Total**                | ~1,130| -          |

### File Sizes

| File                     | Size  |
|--------------------------|-------|
| main.js                  | ~3 KB |
| renderer.js              | ~12 KB|
| index.html               | ~5 KB |
| styles.css               | ~12 KB|
| screen-protection.cc     | ~4 KB |
| screen-protection.node   | ~100 KB (compiled) |

## Maintenance

### Regular Updates

- **Electron**: Update when security patches released
- **Dependencies**: Monthly review for vulnerabilities
- **Windows API**: Monitor Microsoft docs for changes

### Testing Checklist

- [ ] Screenshot protection works on latest Windows
- [ ] All navigation controls functional
- [ ] Tabs create/close properly
- [ ] Address bar URL formatting
- [ ] Welcome screen displays
- [ ] Context menu works
- [ ] No memory leaks with multiple tabs
- [ ] Ad blocker functioning
- [ ] Security indicators accurate

## Contributing

When contributing, follow this structure:

1. **Core logic** → `main.js`, `renderer.js`
2. **UI changes** → `index.html`, `styles.css`
3. **Protection code** → `src/screen-protection.cc`
4. **Documentation** → Appropriate `.md` file
5. **Build config** → `package.json`, `binding.gyp`

---

**Last Updated**: 2026-02-17

**Project Version**: 1.0.0

