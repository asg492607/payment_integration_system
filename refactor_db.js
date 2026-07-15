const fs = require('fs');

function processFile(filename, replacements) {
  if (!fs.existsSync(filename)) return;
  let content = fs.readFileSync(filename, 'utf8');
  let original = content;
  for (const [search, replace] of replacements) {
    if (typeof search === 'string') {
      content = content.replace(search, replace);
    } else {
      content = content.replace(search, replace);
    }
  }
  if (content !== original) {
    fs.writeFileSync(filename, content);
    console.log(`Refactored ${filename}`);
  }
}

// admin.js
processFile('admin.js', [
  [
    `const users = await db.find('users', u => u.enterprise_id === req.enterpriseUserId);`,
    `const users = await db.query('users', 'enterprise_id', req.enterpriseUserId);`
  ],
  [
    `const queue = await db.find('sms_queue', s => s.enterprise_id === req.enterpriseUserId);`,
    `const queue = await db.query('sms_queue', 'enterprise_id', req.enterpriseUserId);`
  ],
  [
    `const plans = await db.find('enterprise_plans', p => p.enterprise_id === req.enterpriseUserId);`,
    `const plans = await db.query('enterprise_plans', 'enterprise_id', req.enterpriseUserId);`
  ],
  [
    `const existing = await db.findOne('enterprise_plans', p => p.enterprise_id === req.enterpriseUserId && p.plan_code === plan_code);`,
    `const __p = await db.query('enterprise_plans', 'enterprise_id', req.enterpriseUserId); const existing = __p.find(p => p.plan_code === plan_code) || null;`
  ]
]);

// api_v1.js
processFile('api_v1.js', [
  [
    `const user = await db.findOne('enterprise_users', u => u.api_key === apiKey);`,
    `const user = (await db.query('enterprise_users', 'api_key', apiKey))[0] || null;`
  ]
]);

// auth.js
processFile('auth.js', [
  [
    `const session = await db.findOne('enterprise_sessions', s => s.token_hash === tokenHash);`,
    `const session = (await db.query('enterprise_sessions', 'token_hash', tokenHash))[0] || null;`
  ],
  [
    `const existing = await db.findOne('enterprise_users', u => u.email === email.toLowerCase());`,
    `const existing = (await db.query('enterprise_users', 'email', email.toLowerCase()))[0] || null;`
  ],
  [
    `const user = await db.findOne('enterprise_users', u => u.email === email.toLowerCase());`,
    `const user = (await db.query('enterprise_users', 'email', email.toLowerCase()))[0] || null;`
  ]
]);

// emailEngine.js - Cannot easily optimize because it filters on two !! variables which isn't a direct equality.
// We'll leave it as db.find or we could optimize it later.

// heartbeat.js
processFile('heartbeat.js', [
  [
    `const allDevices = await db.find('devices', d => d.enterprise_id === eId);`,
    `const allDevices = await db.query('devices', 'enterprise_id', eId);`
  ]
]);

// orders.js
processFile('orders.js', [
  [
    `const allPlans = await db.find('enterprise_plans', p => p.enterprise_id === eId);`,
    `const allPlans = await db.query('enterprise_plans', 'enterprise_id', eId);`
  ],
  [
    /let user = await db\.findOne\('users',\s*u\s*=>\s*u\.email === email\.toLowerCase\(\)\s*&&\s*u\.enterprise_id === eId\);/g,
    `let user = (await db.query('users', 'enterprise_id', eId)).find(u => u.email === email.toLowerCase()) || null;`
  ],
  [
    /const txn = await db\.findOne\('transactions',\s*t\s*=>\s*t\.order_id === req\.params\.id\s*&&\s*t\.status === 'verified'\);/g,
    `const txn = (await db.query('transactions', 'order_id', req.params.id)).find(t => t.status === 'verified') || null;`
  ]
]);

// verificationEngine.js
processFile('verificationEngine.js', [
  [
    `const orders = await db.find('orders', o => o.enterprise_id === eId);`,
    `const orders = await db.query('orders', 'enterprise_id', eId);`
  ],
  [
    `const users = await db.find('users', u => u.enterprise_id === eId);`,
    `const users = await db.query('users', 'enterprise_id', eId);`
  ]
]);

console.log('Finished refactoring.');
