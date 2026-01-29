const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({ data: { email: 'dev+test@example.com', name: 'Dev Test' } });
      console.log('Created test user', user.id);
    } else {
      console.log('Using existing user', user.id);
    }
    const note = await prisma.note.create({
      data: {
        title: 'Test note from script',
        body: 'This is a test',
        type: 'CHECKLIST',
        ownerId: user.id,
        items: {
          create: [
            { content: 'Item A', checked: false, ord: 0, indent: 0 },
            { content: 'Item B', checked: false, ord: 1, indent: 0 }
          ]
        }
      },
      include: { items: true }
    });
    console.log('Created note', note.id, 'items:', note.items.map(i=>({id:i.id,ord:i.ord,indent:i.indent}))); 
  } catch (err) {
    console.error('Error creating note', err);
    process.exitCode = 2;
  } finally {
    try { await prisma.$disconnect(); } catch(e){}
  }
})();
