# ⚡ Quick Start Guide

Get up and running with Secure Browser in 3 minutes!

## 🎯 For First-Time Users

### Step 1: Install Prerequisites (5 minutes)

1. **Install Node.js**: https://nodejs.org/ (Download the LTS version)
2. **Install Build Tools**: Open Command Prompt as Administrator and run:
   ```bash
   npm install --global windows-build-tools
   ```

### Step 2: Setup Browser (2 minutes)

Open Command Prompt in the Browser folder and run:

```bash
setup.bat
```

Wait for it to complete. You should see "Setup Complete!"

### Step 3: Run Browser (Instant)

```bash
run.bat
```

That's it! The browser should open.

## 🧪 Test Screenshot Protection

1. Open the browser
2. Navigate to any website (e.g., google.com)
3. Press `Windows + Shift + S` (Snipping Tool)
4. Try to capture the browser window

**Expected**: You'll see a black screen instead of the actual content! ✅

## 💡 Quick Tips

### Navigation
- **New Tab**: Click the `+` button or `Ctrl+T`
- **Close Tab**: Click `×` on the tab
- **Go Back/Forward**: Use the arrow buttons
- **Refresh**: Click the reload button

### Address Bar
- Type a **URL**: `example.com` (automatically adds https://)
- **Search**: Type anything without a domain and hit Enter

### Menu
- Click the three dots (⋮) for more options
- Access settings, about, and more

## 🎨 Features at a Glance

| Feature | Status |
|---------|--------|
| 🛡️ Screenshot Protection | ✅ Active |
| 🚫 Ad Blocker | ✅ Built-in |
| 🔒 HTTPS Security | ✅ Indicator shown |
| 📑 Multiple Tabs | ✅ Unlimited |
| ⚡ Fast Loading | ✅ Chromium-based |

## ⚠️ Common Issues

### Browser won't start?
```bash
npm install
npm run rebuild
npm start
```

### Screenshot protection not working?
- Check Windows version: `winver` (need 10 Build 17134+)
- Rebuild: `npm run rebuild`

### Websites won't load?
- Check internet connection
- Try disabling ad blocker temporarily

## 🔄 Daily Usage

Every time you want to use the browser:

```bash
run.bat
```

Or:

```bash
npm start
```

## 🎓 Learn More

- Full documentation: [README.md](README.md)
- Installation help: [INSTALLATION.md](INSTALLATION.md)
- Configuration: Edit `main.js`

## 🆘 Need Help?

1. Check error messages in console
2. Review INSTALLATION.md
3. Ensure prerequisites are installed
4. Try running as Administrator

---

**Enjoy secure, private browsing! 🔒**

