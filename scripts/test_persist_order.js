(function(){
  try { require('dotenv').config(); } catch(e) {}
  const jwt = require('jsonwebtoken');
  const fetch = global.fetch || require('node-fetch');
  const fs = require('fs');
  let secret = process.env.JWT_SECRET;
  if (!secret) {
    try {
      const raw = fs.readFileSync('.env','utf8');
      const m = raw.match(/^JWT_SECRET=(.*)$/m);
      if (m) secret = m[1].trim();
    } catch(e){}
  }
  if (!secret) { console.error('JWT_SECRET not set'); process.exit(2); }
  (async ()=>{
    const {PrismaClient} = require('@prisma/client');
    const p = new PrismaClient();
    await p.$connect();
    const user = await p.user.findFirst();
    if (!user) { console.error('no user'); process.exit(2); }
    const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '1h' });
    const notes = await p.note.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: 'desc' } });
    console.log('Current note ids:', notes.map(n=>n.id));
    // reverse order for test
    const ids = notes.map(n=>n.id).reverse();
    console.log('Sending order:', ids);
    const res = await fetch('http://localhost:4000/api/notes/order', { method: 'PATCH', headers: { 'Content-Type':'application/json', Authorization: 'Bearer '+token }, body: JSON.stringify({ ids }) });
    console.log('Status', res.status);
    console.log(await res.text());
    await p.$disconnect();
  })();
})();
