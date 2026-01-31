#!/usr/bin/env node
/*
Quick check for Yjs persistence: prints yData size and body length for notes.
Usage:
  node scripts/check_ydata.js                # lists recent notes (id, title, yData bytes, body length)
  node scripts/check_ydata.js <noteId>       # prints details for a specific note
*/
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const argId = process.argv[2] ? Number(process.argv[2]) : null;
  if (argId && Number.isFinite(argId)) {
    const note = await prisma.note.findUnique({ where: { id: argId } });
    if (!note) {
      console.log(`Note ${argId} not found.`);
      return;
    }
    const yBytes = note.yData ? (Buffer.isBuffer(note.yData) ? note.yData.length : 0) : 0;
    const bodyLen = note.body ? String(note.body).length : 0;
    console.log(JSON.stringify({ id: note.id, title: note.title, type: note.type, yDataBytes: yBytes, bodyLength: bodyLen }, null, 2));
  } else {
    const notes = await prisma.note.findMany({ orderBy: { id: 'desc' }, take: 10 });
    const out = notes.map(n => ({ id: n.id, title: n.title, type: n.type, yDataBytes: n.yData ? (Buffer.isBuffer(n.yData) ? n.yData.length : 0) : 0, bodyLength: n.body ? String(n.body).length : 0 }));
    console.table(out);
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
