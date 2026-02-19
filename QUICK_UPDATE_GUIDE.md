# 🚀 Quick Auto-Update Setup (5 Minutes)

## ✅ What's Already Done

- ✅ Auto-updater code is implemented
- ✅ "Check for Updates" button in Settings → About
- ✅ Update notifications with download & restart buttons
- ✅ Automatic background checks (every 4 hours)

## 📝 What You Need to Do

### Step 1: Create GitHub Repository (2 min)

1. Go to [github.com](https://github.com) → **New repository**
2. Name: `proton-browser` (or your choice)
3. Set to **Public**
4. Click **Create repository**

### Step 2: Get GitHub Token (1 min)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. **Generate new token (classic)**
3. Name: `Proton Browser Updater`
4. Check: ✅ `repo`
5. **Generate** → **COPY THE TOKEN**

### Step 3: Set Token (30 sec)

**Windows PowerShell:**
```powershell
$env:GH_TOKEN = "YOUR_TOKEN_HERE"
```

**Or permanently:**
```powershell
[System.Environment]::SetEnvironmentVariable("GH_TOKEN", "YOUR_TOKEN_HERE", "User")
```

### Step 4: Update Code (1 min)

**Edit `main.js` (line 756-757):**
```javascript
const UPDATER_GITHUB_OWNER = 'your-github-username';  // ← Your username
const UPDATER_GITHUB_REPO  = 'proton-browser';          // ← Your repo name
```

**Edit `package.json` (line 42-46):**
```json
"publish": {
  "provider": "github",
  "owner": "your-github-username",  // ← Your username
  "repo": "proton-browser"           // ← Your repo name
}
```

### Step 5: Publish First Release (30 sec)

1. **Update version** in `package.json`:
   ```json
   "version": "1.0.1"
   ```

2. **Build & publish:**
   ```bash
   npm run publish:github
   ```

3. **Verify:** Go to your GitHub repo → **Releases** → Should see v1.0.1

## 🎯 That's It!

Users will now:
- ✅ Get notified when updates are available
- ✅ See "Check for Updates" button in Settings
- ✅ Auto-check every 4 hours in background
- ✅ Download and install updates with one click

## 📦 Future Updates

Every time you want to release:

1. Update `package.json` version: `"1.0.2"`
2. Run: `npm run publish:github`
3. Done! Users get notified automatically.

---

**Need more details?** See `AUTO_UPDATE_SETUP.md` for full documentation.

