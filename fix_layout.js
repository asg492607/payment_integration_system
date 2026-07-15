const fs = require('fs');
let content = fs.readFileSync('dashboard.html', 'utf8');

// Normalize line endings for reliable string replacement
content = content.replace(/\r\n/g, '\n');

const oldCss = `    @media (max-width: 1024px) {
      .dashboard { flex-direction: column; }
      .sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border); display: flex; flex-direction: row; align-items: center; justify-content: space-between; overflow-x: auto; padding: 12px; }
      .sidebar-nav { display: flex; flex-direction: row; gap: 8px; margin-top: 0; padding: 0 12px; overflow-x: auto; white-space: nowrap; }
      .nav-item { margin-bottom: 0; padding: 8px 12px; }
      .sidebar-footer { border-top: none; padding: 0 12px; border-left: 1px solid var(--border); display: flex; flex-direction: row; gap: 8px; }
      .main-content { margin-left: 0; padding: 16px; }
      
      div[style*="grid-template-columns:2fr 1fr"],
      div[style*="grid-template-columns: 2fr 1fr"],
      div[style*="grid-template-columns:1fr 1fr"],
      div[style*="grid-template-columns: 1fr 1fr"] {
        grid-template-columns: 1fr !important;
      }
    }

    /* ── Mobile ── */
    @media(max-width:768px){
      .sidebar{transform:translateX(-100%);transition:transform 0.3s}
      .sidebar.open{transform:translateX(0)}
      .main{margin-left:0}
      .form-grid{grid-template-columns:1fr}
      .content{padding:20px}
      .stats-grid{grid-template-columns:1fr 1fr}
    }`;

const newCss = `    /* Sidebar Overlay for Mobile */
    .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 45; display: none; backdrop-filter: blur(2px); }
    .sidebar-overlay.active { display: block; animation: fadeIn 0.2s ease; }

    /* ── Laptop & Tablet ── */
    @media (max-width: 1024px) {
      .sidebar { transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
      .sidebar.open { transform: translateX(0); }
      .main { margin-left: 0; }
      #menu-btn { display: block !important; }
      .form-grid { grid-template-columns: 1fr !important; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
      div[style*="grid-template-columns:2fr 1fr"], div[style*="grid-template-columns: 2fr 1fr"], div[style*="grid-template-columns:1fr 1fr"], div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
    }

    /* ── Mobile ── */
    @media(max-width:768px){
      .stats-grid { grid-template-columns: 1fr; }
      .content { padding: 16px; }
      .topbar { padding: 0 16px; }
    }`;

const oldMenuBtn = `<button onclick="document.getElementById('sidebar').classList.toggle('open')"
        style="display:none;background:none;border:none;cursor:pointer;color:var(--text-1);font-size:1.3rem" id="menu-btn">☰</button>`;
const newMenuBtn = `<button onclick="toggleSidebar()"
        style="display:none;background:none;border:none;cursor:pointer;color:var(--text-1);font-size:1.3rem" id="menu-btn">☰</button>`;

const oldSidebarStart = `<!-- ── Sidebar ─────────────────────────────────────────── -->
<aside class="sidebar" id="sidebar">`;
const newSidebarStart = `<!-- ── Sidebar ─────────────────────────────────────────── -->
<div class="sidebar-overlay" id="sidebar-overlay" onclick="toggleSidebar()"></div>
<aside class="sidebar" id="sidebar">`;

const oldShowPage = `function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

  const page = document.getElementById(\`page-\${name}\`);
  if (page) page.classList.add('active');
  const nav = document.getElementById(\`nav-\${name}\`);
  if (nav) nav.classList.add('active');`;

const newShowPage = `function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if(sb) sb.classList.toggle('open');
  if(ov) ov.classList.toggle('active');
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

  const page = document.getElementById(\`page-\${name}\`);
  if (page) page.classList.add('active');
  const nav = document.getElementById(\`nav-\${name}\`);
  if (nav) nav.classList.add('active');
  
  if (window.innerWidth <= 1024) {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if(sb) sb.classList.remove('open');
    if(ov) ov.classList.remove('active');
  }`;

if (content.includes(oldCss)) content = content.replace(oldCss, newCss);
else console.error("Could not find oldCss");

if (content.includes(oldMenuBtn)) content = content.replace(oldMenuBtn, newMenuBtn);
else console.error("Could not find oldMenuBtn");

if (content.includes(oldSidebarStart)) content = content.replace(oldSidebarStart, newSidebarStart);
else console.error("Could not find oldSidebarStart");

if (content.includes(oldShowPage)) content = content.replace(oldShowPage, newShowPage);
else console.error("Could not find oldShowPage");

fs.writeFileSync('dashboard.html', content);
console.log('Layout fixes applied successfully.');
