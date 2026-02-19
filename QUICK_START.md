# ⚡ Quick Start Guide - GitHub Setup

## 🚀 Fast Setup (5 Minutes)

### 1. Create GitHub Repository
1. Go to [github.com/new](https://github.com/new)
2. Name: `proton-browser`
3. Make it **Public**
4. Click **Create repository**

### 2. Push Your Code

```bash
# In your project folder (C:\Browser)
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/proton-browser.git
git push -u origin main
```

### 3. Get GitHub Token

1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Check **`repo`** scope
4. Click **Generate**
5. **Copy the token**

### 4. Set Token

**PowerShell:**
```powershell
$env:GH_TOKEN="paste-your-token-here"
```

### 5. Update Config Files

Replace `YOUR_GITHUB_USERNAME` in:
- `package.json` (line ~36)
- `main.js` (line ~451)
- `website/index.html` (line ~218)

### 6. Build & Publish

```bash
npm run publish
```

### 7. Host Website (GitHub Pages)

```bash
git checkout -b gh-pages
git add website/
git commit -m "Add website"
git push origin gh-pages
```

Then enable Pages in GitHub Settings → Pages → Source: `gh-pages`

---

## ✅ Done!

- Your app is on GitHub
- Auto-updates work
- Website is live
- Users can download!

---

**Full Guide**: See `GITHUB_SETUP.md` for detailed instructions.

