const fs = require('fs');
let lines = fs.readFileSync('dashboard.html', 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("document.getElementById('s-revenue').textContent = `₹${(stats.totalRevenue||0).toFixed(2)}`;")) {
    lines[i] = "  if (stats) { " + lines[i];
  }
  if (lines[i].includes("document.getElementById('s-users').textContent = stats.activeUsers||0;")) {
    lines[i] = lines[i] + "\n  }";
  }
  
  if (lines[i].includes(`alert("Exact error:`)) {
    lines[i] = ""; // remove alert
  }
}

fs.writeFileSync('dashboard.html', lines.join('\n'));
console.log('Fixed');
