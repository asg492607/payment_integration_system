const fs = require('fs');
const files = ['dashboard.html', 'login.html', 'checkout.html', 'pos.html', 'invoice.html'];
const footer = '<div style="text-align:center; padding: 20px; font-size: 0.8rem; color: #94a3b8; width: 100%; position: relative; z-index: 100;">Developed by ASG</div>\n</body>';

files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    if (!content.includes('Developed by ASG')) {
      content = content.replace('</body>', footer);
      fs.writeFileSync(f, content);
      console.log('Added footer to ' + f);
    }
  }
});
