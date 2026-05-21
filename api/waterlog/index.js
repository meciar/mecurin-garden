const { TableClient } = require('@azure/data-tables');

const TABLE = 'waterlog';

function getUserId(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    return JSON.parse(decoded).userId || null;
  } catch {
    return null;
  }
}

function getClient() {
  return TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING, TABLE);
}

async function ensureTable(client) {
  try { await client.createTable(); } catch { /* already exists */ }
}

module.exports = async function (context, req) {
  const userId = getUserId(req);
  if (!userId) {
    context.res = { status: 401, body: 'Unauthorized' };
    return;
  }

  const client = getClient();
  await ensureTable(client);

  if (req.method === 'GET') {
    const entries = [];
    const iter = client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${userId}'` }
    });
    for await (const e of iter) {
      entries.push({
        id: e.rowKey,
        date: e.date,
        plantIds: JSON.parse(e.plantIds),
        amountMm: e.amountMm,
        notes: e.notes || '',
        createdAt: e.createdAt
      });
    }
    context.res = { status: 200, body: entries };

  } else if (req.method === 'POST') {
    const b = req.body;
    if (!b || !b.date || !b.plantIds || b.amountMm == null) {
      context.res = { status: 400, body: 'Missing fields' };
      return;
    }
    const id = 'w_' + Date.now();
    await client.createEntity({
      partitionKey: userId,
      rowKey: id,
      date: b.date,
      plantIds: JSON.stringify(b.plantIds),
      amountMm: Number(b.amountMm),
      notes: b.notes || '',
      createdAt: new Date().toISOString()
    });
    context.res = { status: 201, body: { id } };

  } else if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) {
      context.res = { status: 400, body: 'Missing id' };
      return;
    }
    try {
      await client.deleteEntity(userId, id);
      context.res = { status: 200, body: { deleted: true } };
    } catch {
      context.res = { status: 404, body: 'Not found' };
    }

  } else {
    context.res = { status: 405, body: 'Method not allowed' };
  }
};
