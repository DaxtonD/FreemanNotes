const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const notes = await prisma.note.findMany({ orderBy: { ord: 'asc' } });
    console.log(notes.map(n => ({ id: n.id, ord: n.ord, title: n.title })));
  } catch (err) {
    console.error(err);
    process.exitCode = 2;
  } finally {
    try { await prisma.$disconnect(); } catch(e){}
  }
})();
