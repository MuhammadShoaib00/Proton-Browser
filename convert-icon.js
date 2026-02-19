const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('INDUS Browser - Icon Converter');
console.log('========================================\n');

// Try to use sharp if available, otherwise provide instructions
try {
  const sharp = require('sharp');
  
  const svgPath = path.join(__dirname, 'assets', 'logo.svg');
  const pngPath = path.join(__dirname, 'assets', 'logo.png');
  
  console.log('Converting SVG to PNG...\n');
  
  sharp(svgPath)
    .resize(256, 256)
    .png()
    .toFile(pngPath)
    .then(info => {
      console.log('✅ SUCCESS! Icon created successfully!');
      console.log('   File: assets/logo.png');
      console.log('   Size:', info.width, 'x', info.height);
      console.log('   Format:', info.format);
      console.log('\n✨ Now run: npm start\n');
      console.log('========================================');
    })
    .catch(err => {
      console.error('❌ Error:', err.message);
      showManualInstructions();
    });
    
} catch (err) {
  console.log('📦 Sharp not installed. Installing now...\n');
  showManualInstructions();
}

function showManualInstructions() {
  console.log('\n📋 MANUAL ICON CREATION:\n');
  console.log('Run these commands:\n');
  console.log('  npm install sharp');
  console.log('  node convert-icon.js\n');
  console.log('OR use online converter:\n');
  console.log('  1. Go to: https://cloudconvert.com/svg-to-png');
  console.log('  2. Upload: assets\\logo.svg');
  console.log('  3. Download and save as: assets\\logo.png\n');
  console.log('========================================');
}

