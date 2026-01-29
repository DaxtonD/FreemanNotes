const https = require('https');
const http = require('http');
const url = require('url');

function headRequest(u){
  return new Promise((resolve, reject) => {
    const parsed = url.parse(u);
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      method: 'HEAD',
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      headers: { 'User-Agent': 'pwa-checker/1.0' }
    };
    const req = lib.request(opts, (res) => {
      resolve({ statusCode: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run(){
  const base = process.argv[2] || process.env.PWA_BASE;
  if(!base){
    console.error('Usage: node scripts/check-pwa-headers.js <base-url>');
    process.exitCode = 2; return;
  }
  const endpoints = [
    '/sw.js',
    '/manifest.webmanifest',
    '/icons/android-chrome-192x192.png',
    '/icons/android-chrome-512x512.png',
    '/icons/apple-touch-icon.png'
  ];
  for(const ep of endpoints){
    const u = base.replace(/\/$/, '') + ep;
    try{
      const r = await headRequest(u);
      console.log(u, '-', r.statusCode, '-', (r.headers['content-type'] || 'no-ct'));
    }catch(err){
      console.log(u, '- ERROR -', err.message);
    }
  }
}

run();
