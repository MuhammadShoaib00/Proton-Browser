# 🚀 GitHub Setup & Auto-Update Guide

This guide will help you set up GitHub repository, push your code, and enable automatic updates for Proton Browser.

## 📋 Prerequisites

- GitHub account
- Git installed on your computer
- Node.js and npm installed

---

## Step 1: Create GitHub Repository

### 1.1 Create New Repository on GitHub

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the **"+"** icon in the top right → **"New repository"**
3. Fill in the details:
   - **Repository name**: `proton-browser` (or your preferred name)
   - **Description**: "Ultra-fast, secure browser with screenshot protection"
   - **Visibility**: Choose **Public** (required for auto-updates)
   - **DO NOT** initialize with README, .gitignore, or license (we already have files)
4. Click **"Create repository"**

### 1.2 Note Your Repository URL

You'll see a page with setup instructions. Note your repository URL:
```
https://github.com/YOUR_USERNAME/proton-browser.git
```

---

## Step 2: Configure Git and Push Code

### 2.1 Initialize Git (if not already done)

Open PowerShell/Command Prompt in your project folder (`C:\Browser`):

```bash
# Check if git is initialized
git status

# If not initialized, run:
git init
```

### 2.2 Configure Git User (if not already done)

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### 2.3 Add Remote Repository

```bash
# Replace YOUR_USERNAME with your GitHub username
git remote add origin https://github.com/YOUR_USERNAME/proton-browser.git

# Verify it was added
git remote -v
```

### 2.4 Create .gitignore File

Create a `.gitignore` file in your project root:

```gitignore
# Dependencies
node_modules/
package-lock.json

# Build outputs
dist/
build/Release/
*.node

# OS files
.DS_Store
Thumbs.db
*.log

# IDE
.vscode/
.idea/
*.swp
*.swo

# Environment
.env
.env.local
```

### 2.5 Stage and Commit Files

```bash
# Add all files
git add .

# Commit
git commit -m "Initial commit: Proton Browser v1.0.0"
```

### 2.6 Push to GitHub

```bash
# Push to main branch
git branch -M main
git push -u origin main
```

If prompted for credentials:
- **Username**: Your GitHub username
- **Password**: Use a **Personal Access Token** (see Step 3)

---

## Step 3: Create GitHub Personal Access Token

GitHub requires a token for authentication (passwords no longer work).

### 3.1 Create Token

1. Go to GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Fill in:
   - **Note**: "Proton Browser Publishing"
   - **Expiration**: Choose your preference (90 days, 1 year, etc.)
   - **Scopes**: Check **`repo`** (full control of private repositories)
4. Click **"Generate token"**
5. **COPY THE TOKEN IMMEDIATELY** (you won't see it again!)

### 3.2 Set Token as Environment Variable

**Windows PowerShell:**
```powershell
# Set for current session
$env:GH_TOKEN="your-token-here"

# Set permanently (optional)
[System.Environment]::SetEnvironmentVariable('GH_TOKEN', 'your-token-here', 'User')
```

**Windows Command Prompt:**
```cmd
setx GH_TOKEN "your-token-here"
```

**Note**: Close and reopen your terminal after setting permanently.

---

## Step 4: Update Configuration Files

### 4.1 Update package.json

Edit `package.json` and replace:
- `YOUR_GITHUB_USERNAME` with your actual GitHub username
- `proton-browser` with your repository name (if different)

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "YOUR_GITHUB_USERNAME",
    "repo": "proton-browser"
  }
}
```

### 4.2 Update main.js

Edit `main.js` and replace:
- `YOUR_GITHUB_USERNAME` with your actual GitHub username
- `proton-browser` with your repository name (if different)

```javascript
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'YOUR_GITHUB_USERNAME',
  repo: 'proton-browser'
});
```

### 4.3 Update website/index.html

Edit `website/index.html` and replace:
- `YOUR_GITHUB_USERNAME` with your actual GitHub username
- `proton-browser` with your repository name (if different)

```javascript
const GITHUB_USERNAME = 'YOUR_GITHUB_USERNAME';
const GITHUB_REPO = 'proton-browser';
```

Also update the footer link:
```html
<a href="https://github.com/YOUR_GITHUB_USERNAME/proton-browser" target="_blank">GitHub</a>
```

---

## Step 5: Build and Publish First Release

### 5.1 Build the Application

```bash
# Make sure you're in the project directory
cd C:\Browser

# Build for Windows
npm run build:win
```

This will:
- Compile your app
- Create an installer in the `dist/` folder
- Take a few minutes

### 5.2 Publish to GitHub Releases

```bash
# Make sure GH_TOKEN is set
echo $env:GH_TOKEN  # PowerShell
# or
echo %GH_TOKEN%      # CMD

# Publish (this will create a GitHub release automatically)
npm run publish
```

This will:
- Build the app
- Create a GitHub release
- Upload the installer
- Tag the release with the version from `package.json`

### 5.3 Verify Release

1. Go to your GitHub repository
2. Click **"Releases"** in the right sidebar
3. You should see a new release with your version number
4. The installer file should be attached

---

## Step 6: Test Auto-Updates

### 6.1 Install the Published Version

1. Download the installer from GitHub Releases
2. Install it on your computer
3. Run the app

### 6.2 Test Update Flow

1. **Create a new version**:
   - Edit `package.json`: Change `"version": "1.0.0"` to `"version": "1.0.1"`
   - Make a small change (e.g., update a comment)
   - Commit and push:
     ```bash
     git add .
     git commit -m "Version 1.0.1"
     git push
     ```

2. **Build and publish new version**:
   ```bash
   npm run publish
   ```

3. **Test in installed app**:
   - Open the installed Proton Browser
   - Wait 5 seconds (or restart the app)
   - You should see an update notification
   - The app will download and prompt to restart

---

## Step 7: Host the Download Website

### Option A: GitHub Pages (Free & Easy)

1. **Create gh-pages branch**:
   ```bash
   git checkout -b gh-pages
   ```

2. **Copy website files**:
   ```bash
   # Copy website folder contents to root
   cp website/index.html .
   # Or keep it in website/ folder
   ```

3. **Push to gh-pages**:
   ```bash
   git add .
   git commit -m "Add website"
   git push origin gh-pages
   ```

4. **Enable GitHub Pages**:
   - Go to repository → **Settings** → **Pages**
   - **Source**: Select `gh-pages` branch
   - **Folder**: `/ (root)` or `/website`
   - Click **Save**

5. **Your website URL**:
   ```
   https://YOUR_USERNAME.github.io/proton-browser/
   ```

### Option B: Netlify (Free & Easy)

1. Go to [Netlify.com](https://netlify.com) and sign up
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag and drop your `website/` folder
4. Your site will be live at: `https://random-name.netlify.app`
5. You can add a custom domain later

### Option C: Your Own Server

1. Upload `website/index.html` to your web server
2. Make sure it's accessible via HTTP/HTTPS
3. Update any hardcoded URLs if needed

---

## Step 8: Update Workflow (For Future Releases)

Every time you want to release a new version:

### 8.1 Update Version Number

Edit `package.json`:
```json
"version": "1.0.2"  // Increment version
```

### 8.2 Commit Changes

```bash
git add .
git commit -m "Version 1.0.2 - [Describe changes]"
git push
```

### 8.3 Build and Publish

```bash
npm run publish
```

That's it! The app will automatically:
- Create a new GitHub release
- Upload the installer
- Users will get update notifications

---

## 🔧 Troubleshooting

### Issue: "GH_TOKEN not found"

**Solution**: Set the environment variable:
```powershell
$env:GH_TOKEN="your-token-here"
```

### Issue: "Repository not found"

**Solution**: 
- Check your GitHub username and repo name in `package.json`
- Make sure the repository exists and is public
- Verify your token has `repo` scope

### Issue: "Build fails"

**Solution**:
- Make sure all dependencies are installed: `npm install`
- Rebuild native module: `npm run rebuild`
- Check for errors in the console

### Issue: "Auto-update not working"

**Solution**:
- Make sure you're testing with a **packaged** app (not `npm start`)
- Check that the GitHub release exists and has the installer attached
- Verify `main.js` has the correct GitHub username/repo
- Check console logs for errors

### Issue: "Website not showing latest version"

**Solution**:
- Make sure `website/index.html` has the correct GitHub username
- Check that GitHub API is accessible (might be rate-limited)
- Clear browser cache

---

## 📝 Quick Reference Commands

```bash
# Initial setup
git init
git remote add origin https://github.com/YOUR_USERNAME/proton-browser.git
git add .
git commit -m "Initial commit"
git push -u origin main

# Set GitHub token
$env:GH_TOKEN="your-token-here"

# Build and publish
npm run publish

# Update version and release
# 1. Edit package.json version
# 2. git add . && git commit -m "Version X.X.X" && git push
# 3. npm run publish
```

---

## ✅ Checklist

- [ ] GitHub repository created
- [ ] Code pushed to GitHub
- [ ] GitHub Personal Access Token created
- [ ] `GH_TOKEN` environment variable set
- [ ] `package.json` updated with GitHub username/repo
- [ ] `main.js` updated with GitHub username/repo
- [ ] `website/index.html` updated with GitHub username/repo
- [ ] First release built and published
- [ ] Website hosted (GitHub Pages/Netlify/your server)
- [ ] Auto-update tested with second release

---

## 🎉 You're Done!

Your Proton Browser now has:
- ✅ GitHub repository with code
- ✅ Automatic updates via GitHub Releases
- ✅ Download website for users
- ✅ Professional release workflow

Users can now:
1. Download from your website
2. Get automatic update notifications
3. Always have the latest version

---

## 📚 Additional Resources

- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [Electron Auto-Updater](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron Builder](https://www.electron.build/)
- [GitHub Pages](https://pages.github.com/)

---

**Need Help?** Check the console logs for detailed error messages!

