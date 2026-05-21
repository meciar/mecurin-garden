const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');

const CONTAINER = 'photos';
const ADMIN_USER_DETAILS = process.env.ADMIN_USER_DETAILS;

function getPrincipal(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch { return null; }
}

function isAdmin(req) {
  const p = getPrincipal(req);
  return p && ADMIN_USER_DETAILS && p.userDetails === ADMIN_USER_DETAILS;
}

function getContainer() {
  const client = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING);
  return client.getContainerClient(CONTAINER);
}

module.exports = async function (context, req) {
  const container = getContainer();

  if (req.method === 'GET') {
    const year = req.query.year || new Date().getFullYear().toString();
    const photos = [];
    const iter = container.listBlobsFlat({ prefix: `${year}/` });
    for await (const blob of iter) {
      photos.push({
        name: blob.name,
        url: `${container.url}/${blob.name}`,
        created: blob.properties.createdOn
      });
    }
    photos.sort((a, b) => new Date(b.created) - new Date(a.created));
    context.res = { status: 200, body: photos, headers: { 'Content-Type': 'application/json' } };

  } else if (req.method === 'POST') {
    if (!isAdmin(req)) { context.res = { status: 403, body: 'Forbidden' }; return; }
    const { year, filename, contentType } = req.body || {};
    if (!year || !filename) { context.res = { status: 400, body: 'Missing year or filename' }; return; }
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobName = `${year}/${Date.now()}_${safe}`;
    const blobClient = container.getBlockBlobClient(blobName);
    const sasUrl = await blobClient.generateSasUrl({
      permissions: BlobSASPermissions.from({ create: true, write: true }),
      expiresOn: new Date(Date.now() + 10 * 60 * 1000),
      contentType: contentType || 'image/jpeg'
    });
    context.res = {
      status: 200,
      body: { sasUrl, blobName, publicUrl: `${container.url}/${blobName}` },
      headers: { 'Content-Type': 'application/json' }
    };

  } else if (req.method === 'DELETE') {
    if (!isAdmin(req)) { context.res = { status: 403, body: 'Forbidden' }; return; }
    const blobName = req.query.blob;
    if (!blobName) { context.res = { status: 400, body: 'Missing blob' }; return; }
    await container.deleteBlob(blobName);
    context.res = { status: 200, body: { deleted: true } };

  } else {
    context.res = { status: 405, body: 'Method not allowed' };
  }
};
