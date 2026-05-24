const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const folders = ['public', 'server', 'server/db', 'server/engine', 'server/lib', 'server/routes'];

// 1. Move all files to root
function flatten() {
  const allFiles = [];
  
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      if (fs.statSync(fullPath).isDirectory()) {
        scan(fullPath);
      } else {
        allFiles.push(fullPath);
      }
    }
  }

  scan(path.join(rootDir, 'public'));
  scan(path.join(rootDir, 'server'));

  allFiles.forEach(file => {
    const filename = path.basename(file);
    const dest = path.join(rootDir, filename);
    if (file !== dest) {
      fs.copyFileSync(file, dest);
      fs.unlinkSync(file);
    }
  });

  // Remove dirs
  ['server/db', 'server/engine', 'server/lib', 'server/routes', 'server', 'public'].forEach(d => {
    const p = path.join(rootDir, d);
    if (fs.existsSync(p)) fs.rmdirSync(p, { recursive: true });
  });
}

flatten();
console.log("Flattened successfully.");

