# 💜 INDUS Browser - Branding Guidelines

## Brand Identity

**INDUS Browser** represents the perfect fusion of **speed**, **security**, and **style**.

### Brand Values

- **Ultra-Fast**: Optimized performance with hardware acceleration
- **Secure**: Military-grade screenshot protection
- **Beautiful**: Modern gradient-based UI design
- **Private**: No tracking, complete user privacy

## Logo

The INDUS Browser logo features:

- **Shield Symbol**: Represents security and protection
- **Letter "I"**: Bold and prominent, symbolizing INDUS
- **Speed Lines**: Indicating ultra-fast performance
- **Gradient Colors**: Purple to pink gradient representing innovation

### Logo Files

- `assets/logo.svg` - Main SVG logo (256x256)
- Scalable vector format for any size

## Color Palette

### Primary Colors

```css
Primary Gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%)
- Purple: #667eea
- Deep Purple: #764ba2
```

### Accent Colors

```css
Accent Gradient: linear-gradient(135deg, #f093fb 0%, #f5576c 100%)
- Pink: #f093fb
- Coral: #f5576c
```

### Background Colors

```css
- Dark Background: #0f0f23
- Secondary Background: #1a1a2e
- Tertiary Background: #16213e
```

### Text Colors

```css
- Primary Text: #ffffff
- Secondary Text: #a8b2d1
```

### Other Colors

```css
- Border: #2d3561
- Success: #4CAF50
```

## Typography

### Font Family

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
```

### Font Weights

- Regular: 400
- Medium: 500
- Semi-Bold: 600
- Bold: 700
- Extra Bold: 800

### Font Sizes

- Logo/Hero: 56px
- H1: 48px
- H2: 32px
- H3: 20px
- Body: 14-16px
- Small: 13px

## UI Elements

### Buttons

- Border Radius: 6-8px
- Padding: 8-10px
- Hover Effect: Gradient background with translateY(-1px)
- Transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1)

### Input Fields

- Border Radius: 24-32px
- Border: 2px solid
- Focus: Purple glow effect
- Padding: 16-18px

### Cards

- Border Radius: 12-16px
- Border: 2px solid
- Hover: Lift effect with shadow
- Top Border: Gradient line on hover

### Tabs

- Border Radius: 10px 10px 0 0
- Active Tab: Gradient bottom border
- Hover: Slight lift effect

## Animations

### Standard Timing

```css
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

### Key Animations

**Float Animation** (3s infinite)
```css
@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}
```

**Fade In Up** (0.8s)
```css
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
```

**Pulse** (2s infinite)
```css
@keyframes pulse {
    0%, 100% { opacity: 0.9; }
    50% { opacity: 1; }
}
```

## Icons

### Icon Style

- Stroke width: 2px
- Size: 14-20px
- Color: Inherits from parent
- Transition: 0.3s

### Icon Library

Using inline SVG for:
- Navigation arrows
- Reload symbol
- Home icon
- Close (X) icon
- Shield (security) icon

## Usage Guidelines

### Do's ✅

- Use the official gradient colors
- Maintain the purple-pink theme
- Apply smooth animations
- Keep shadows subtle
- Use the official logo
- Follow spacing guidelines

### Don'ts ❌

- Don't modify the logo proportions
- Don't use different purple shades
- Don't use harsh transitions
- Don't overcrowd the interface
- Don't use conflicting color schemes

## Brand Voice

### Tone

- **Professional** yet friendly
- **Technical** yet accessible
- **Confident** yet humble
- **Modern** yet reliable

### Messaging

**Tagline**: "Ultra-Fast • Secure • Screenshot Protected"

**Key Messages**:
- "Experience blazing-fast browsing"
- "Your privacy, protected"
- "Screenshot protection that actually works"
- "Beautiful design meets powerful performance"

## Application

### Window Title

```
INDUS Browser
```

### Console Messages

```javascript
console.log('%c🚀 INDUS Browser', 'color: #667eea; font-size: 20px; font-weight: bold;');
console.log('%c🔒 Screenshot Protection Active', 'color: #4CAF50; font-size: 16px; font-weight: bold;');
console.log('%c⚡ Ultra-Fast Performance Mode Enabled', 'color: #f5576c; font-size: 14px;');
```

### About Dialog

```
INDUS Browser v1.0

Ultra-fast secure browser with screenshot protection.
Protected from screenshots and screen recording.
Based on Electron and Chromium.
```

## File Naming

- Use lowercase with hyphens: `indus-browser`
- Logo files: `logo.svg`, `logo.png`
- No spaces in file names

## Social Media

### Profile Picture

Use `logo.svg` as profile picture

### Cover Image Dimensions

- Twitter: 1500x500
- Facebook: 820x312
- LinkedIn: 1128x191

### Hashtags

- #INDUSBrowser
- #SecureBrowsing
- #PrivacyFirst
- #UltraFastBrowser

## Versioning

Current Version: **1.0.0**

Version Format: **MAJOR.MINOR.PATCH**

---

**INDUS Browser** - Where Speed Meets Security

