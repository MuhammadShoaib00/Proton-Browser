# 🚀 Deploy Website in 3 Steps

## Step 1: Update GitHub Username

**Open:** `website/index.html`  
**Find:** Line **1551**  
**Change:**
```javascript
const GITHUB_USERNAME = 'YOUR_GITHUB_USERNAME';
```
**To:**
```javascript
const GITHUB_USERNAME = 'your-actual-github-username';
```

---

## Step 2: Choose Hosting Method

### Option A: GitHub Pages (FREE)

1. **Create new repo** on GitHub: `proton-browser-website`
2. **Upload website folder:**
   ```bash
   cd C:\Browser\website
   git init
   git add .
   git commit -m "Initial website"
   git remote add origin https://github.com/your-username/proton-browser-website.git
   git push -u origin main
   ```
3. **Enable Pages:**
   - Repo → **Settings** → **Pages**
   - Source: `main` branch
   - Save
4. **Your site:** `https://your-username.github.io/proton-browser-website/`

### Option B: Netlify (FREE, Easiest)

1. Go to [netlify.com](https://netlify.com) → Sign up
2. **Drag & drop** the `website` folder to Netlify
3. **Done!** Your site is live instantly

### Option C: Your Own Server

1. Upload `website` folder contents to your web server
2. Place in `public_html` or `www` directory
3. Done!

---

## Step 3: Test Download Button

1. Visit your live website
2. Click **"Download for Windows"**
3. Should download the latest installer from GitHub

---

## ✅ That's It!

Your website is now live and automatically links to the latest release!

**Need more details?** See `WEBSITE_HOSTING_GUIDE.md`

