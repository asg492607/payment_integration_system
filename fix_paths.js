const fs = require('fs');

const files = fs.readdirSync('.').filter(f => f.endsWith('.js') && f !== 'fix_paths.js' && f !== 'flatten.js');

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  
  // Replace relative requires
  content = content.replace(/require\(['"]\.\/db\/init['"]\)/g, "require('./init')");
  content = content.replace(/require\(['"]\.\/engine\/verificationEngine['"]\)/g, "require('./verificationEngine')");
  content = content.replace(/require\(['"]\.\/lib\/smsQueue['"]\)/g, "require('./smsQueue')");
  content = content.replace(/require\(['"]\.\/routes\/orders['"]\)/g, "require('./orders')");
  content = content.replace(/require\(['"]\.\/routes\/admin['"]\)/g, "require('./admin')");
  content = content.replace(/require\(['"]\.\/routes\/auth['"]\)/g, "require('./auth')");
  
  content = content.replace(/require\(['"]\.\.\/engine\/upiEngine['"]\)/g, "require('./upiEngine')");
  content = content.replace(/require\(['"]\.\.\/engine\/verificationEngine['"]\)/g, "require('./verificationEngine')");
  content = content.replace(/require\(['"]\.\.\/lib\/smsQueue['"]\)/g, "require('./smsQueue')");
  content = content.replace(/require\(['"]\.\.\/lib\/firebase['"]\)/g, "require('./firebase')");
  
  if (f === 'index.js') {
    content = content.replace(/path\.join\(__dirname, '\.\.\/public\/sdk\.js'\)/g, "path.join(__dirname, 'sdk.js')");
    
    const staticBlock = `const publicFiles = ['index.html', 'login.html', 'dashboard.html', 'admin.html', 'app.js', 'style.css'];
publicFiles.forEach(file => {
  app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));`;
    
    content = content.replace(/app\.use\(express\.static\(path\.join\(__dirname, '\.\.\/public'\), \{\s*maxAge:.*,\s*etag:.*,\s*\}\)\);/g, staticBlock);
    
    content = content.replace(/path\.join\(__dirname, '\.\.\/public\/index\.html'\)/g, "path.join(__dirname, 'index.html')");
  }

  fs.writeFileSync(f, content);
});

// Update package.json
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.main = "index.js";
pkg.scripts.start = "node index.js";
pkg.scripts.dev = "nodemon index.js";
pkg.scripts["init-db"] = "node init.js";
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));

// Update render.yaml
let yaml = fs.readFileSync('render.yaml', 'utf8');
yaml = yaml.replace(/startCommand: node server\/index\.js/g, "startCommand: node index.js");
fs.writeFileSync('render.yaml', yaml);

console.log("Paths fixed.");

