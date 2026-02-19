# 🌐 Website Hosting Guide — Proton Browser Download Page

This guide shows you how to host your download website where users can click "Download for Windows" to get the installer.

---

## 🎯 Quick Setup (Choose One Method)

### ✅ Method 1: GitHub Pages (FREE, 5 minutes)

**Best for:** Free hosting, automatic HTTPS, easy updates

#### Step 1: Update GitHub Username in Website

1. Open `website/index.html`
2. Find line **1551**:
   ```javascript
   const GITHUB_USERNAME = 'YOUR_GITHUB_USERNAME';
   ```
3. Replace with your GitHub username:
   ```javascript
   const GITHUB_USERNAME = 'your-actual-username';
   ```

#### Step 2: Push Website to GitHub

1. **Create a new repository** (or use existing):
   ```bash
   cd C:\Browser
   git init
   git add website/
   git commit -m "Add download website"
   ```

2. **Push to GitHub:**
   ```bash
   git remote add origin https://github.com/your-username/proton-browser-website.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - Go to your repo → **Settings** → **Pages**
   - **Source:** Select `main` branch
   - **Folder:** Select `/website` (or `/root` if you put index.html in root)
   - Click **Save**

4. **Your website will be live at:**
   ```
   https://your-username.github.io/proton-browser-website/
   ```
   (Or if you used `/website` folder, you may need to adjust the path)

#### Step 3: Custom Domain (Optional)

1. In GitHub Pages settings, add your custom domain
2. Update DNS records at your domain provider:
   - Add `CNAME` record: `www` → `your-username.github.io`
   - Add `A` record: `@` → GitHub Pages IPs (see GitHub docs)

---

### ✅ Method 2: Netlify (FREE, 3 minutes)

**Best for:** Drag-and-drop deployment, automatic HTTPS, custom domain

#### Step 1: Update GitHub Username

Same as Method 1 — update `website/index.html` line 1551.

#### Step 2: Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) and sign up (free)

2. **Option A — Drag & Drop:**
   - Drag the `website` folder to Netlify dashboard
   - Done! Your site is live

3. **Option B — Git Integration:**
   - Click **"New site from Git"**
   - Connect GitHub → Select your repo
   - **Build command:** (leave empty)
   - **Publish directory:** `website`
   - Click **Deploy**

4. **Your website will be live at:**
   ```
   https://random-name-123.netlify.app
   ```

5. **Custom Domain:**
   - Go to **Domain settings** → **Add custom domain**
   - Follow Netlify's DNS instructions

---

### ✅ Method 3: Vercel (FREE, 3 minutes)

**Best for:** Fast CDN, automatic HTTPS, great performance

1. Go to [vercel.com](https://vercel.com) and sign up
2. Click **"New Project"**
3. Import your GitHub repo
4. **Root Directory:** `website`
5. Click **Deploy**
6. Done! Your site is live at `https://your-project.vercel.app`

---

### ✅ Method 4: Your Own Server (Custom Hosting)

**Best for:** Full control, existing web server

#### Step 1: Update GitHub Username

Same as Method 1 — update `website/index.html` line 1551.

#### Step 2: Upload Files

1. **Via FTP/SFTP:**
   - Upload entire `website` folder to your server
   - Place in `public_html` or `www` directory

2. **Via SSH:**
   ```bash
   scp -r website/* user@yourserver.com:/var/www/html/
   ```

#### Step 3: Configure Web Server

**Apache (.htaccess):**
```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</IfModule>
```

**Nginx:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 🔧 How the Download Button Works

The website automatically:

1. **Fetches latest release** from GitHub API
2. **Finds the `.exe` installer** in release assets
3. **Updates download button** to point to the installer
4. **Shows version number** (e.g., "v1.0.1")
5. **Falls back** to GitHub releases page if API fails

### Code Location

The download logic is in `website/index.html` around **line 1551-1577**:

```javascript
const GITHUB_USERNAME = 'your-username';  // ← Update this
const GITHUB_REPO     = 'proton-browser';  // ← Your repo name

async function fetchRelease() {
    // Fetches latest release from GitHub
    // Finds .exe file
    // Updates download button href
}
```

---

## 📝 Step-by-Step: Complete Setup

### 1. Update Website Code

**Edit `website/index.html` line 1551:**
```javascript
const GITHUB_USERNAME = 'your-actual-github-username';
const GITHUB_REPO     = 'proton-browser';  // Your repo name
```

### 2. Test Locally

1. Open `website/index.html` in a browser
2. Open Developer Tools (F12) → Console
3. Check for errors
4. Click "Download for Windows" — should open GitHub release

### 3. Deploy (Choose One)

**GitHub Pages:**
```bash
cd C:\Browser
git init
git add website/
git commit -m "Initial website"
git remote add origin https://github.com/your-username/proton-browser-website.git
git push -u origin main
# Then enable Pages in repo Settings
```

**Netlify:**
- Drag `website` folder to Netlify dashboard
- Done!

**Custom Server:**
- Upload `website` folder contents to your web server
- Done!

### 4. Verify

1. Visit your live website
2. Click "Download for Windows"
3. Should download `Proton-Browser-Setup-X.X.X.exe`

---

## 🎨 Customization

### Change Download Button Text

**Edit `website/index.html` line 1097:**
```html
<span>Download for Windows</span>
```
Change to:
```html
<span>Download Now</span>
```

### Change Colors/Styles

All styles are in `<style>` tag at the top of `website/index.html` (lines 12-1000+).

### Add More Download Buttons

Find other download buttons and update their `id`:
```html
<a href="#" id="main-download-btn">Download</a>
```

The JavaScript automatically updates all buttons with IDs:
- `hero-download-btn`
- `main-download-btn`

---

## 🔄 Updating the Website

### After Publishing a New Release

The website **automatically updates** because it fetches the latest release from GitHub API. No manual changes needed!

**However**, if you want to update the website code:

1. Make changes to `website/index.html`
2. Push to GitHub (if using GitHub Pages)
3. Or re-upload to your server

---

## ✅ Checklist

Before going live:

- [ ] Updated `GITHUB_USERNAME` in `website/index.html`
- [ ] Updated `GITHUB_REPO` if different from `proton-browser`
- [ ] Tested download button locally (opens GitHub release)
- [ ] Deployed website to hosting provider
- [ ] Verified download button works on live site
- [ ] Added custom domain (optional)
- [ ] Set up HTTPS (automatic on GitHub Pages/Netlify/Vercel)

---

## 🚀 Quick Start (GitHub Pages)

**Fastest way to get your website live:**

1. **Update username:**
   ```javascript
   // website/index.html line 1551
   const GITHUB_USERNAME = 'your-username';
   ```

2. **Create GitHub repo:**
   ```bash
   cd C:\Browser\website
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/your-username/proton-browser-website.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable Pages:**
   - Repo → Settings → Pages
   - Source: `main` branch
   - Save

4. **Your site is live!**
   ```
   https://your-username.github.io/proton-browser-website/
   ```

---

## 📞 Troubleshooting

### ❌ Download button doesn't work

**Check:**
- GitHub username is correct in `website/index.html`
- GitHub repo is public (required for API access)
- At least one release exists with a `.exe` file
- Browser console shows no errors (F12)

### ❌ "404 Not Found" on GitHub API

**Fix:**
- Verify GitHub username and repo name are correct
- Ensure repo is **public**
- Check that you've published at least one release

### ❌ Website shows "Free" instead of version

**Fix:**
- GitHub API call failed (check console)
- Ensure releases exist in your repo
- Verify GitHub username is correct

### ❌ Custom domain not working

**Fix:**
- DNS records may take 24-48 hours to propagate
- Verify CNAME/A records are correct
- Check domain provider's DNS settings

---

**🎉 That's it!** Your download website is ready. Users can now visit your site and click "Download for Windows" to get the latest installer automatically.

