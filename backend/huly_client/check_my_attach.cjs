
const { NodeWebSocketFactory } = require('@hcengineering/api-client');
const { getResource, addLocation } = require('@hcengineering/platform');
const { TxOperations } = require('@hcengineering/core');
const clientPkg = require('@hcengineering/client');

const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHRyYSI6eyJhdXRoTWV0aG9kIjoicGFzc3dvcmQifSwiYWNjb3VudCI6ImZmOWVhNjI2LTFmNzItNGUyZS04N2ZlLTczMmVlMTlkYTYzOSIsIndvcmtzcGFjZSI6ImM3MTE1ZjFhLTkxNDQtNDdmMy05Y2M1LTE1NmNkY2RiN2YwYyJ9.y5ayKujBQUR2TWWiuAfxrXxZ4rBn4N_pgV2BpAIu25A';
const endpoint = 'wss://tracker.itco.su/_transactor';

async function main() {
  addLocation(clientPkg.clientId, () => Promise.resolve(require('@hcengineering/client-resources')));
  const clientFactory = await getResource(clientPkg.default.function.GetClient);
  const connection = await clientFactory(token, endpoint, { socketFactory: NodeWebSocketFactory });
  const tx = new TxOperations(connection, 'ff9ea626-1f72-4e2e-87fe-732ee19da639');

  const allIssues = await tx.findAll('tracker:class:Issue', { assignee: '6a969554b09b44d03f62d9f7' });
  const issueIds = allIssues.map(i => i._id);

  const allAttachments = await tx.findAll('attachment:class:Attachment', {});
  const myAttachments = allAttachments.filter(a => issueIds.includes(a.attachedTo));

  console.log('MY ATTACHMENTS COUNT:', myAttachments.length);
  for (const a of myAttachments) {
    const iss = allIssues.find(i => i._id === a.attachedTo);
    const key = iss ? iss.identifier : a.attachedTo;
    console.log('[' + key + '] file: ' + a.file + ' | name: ' + a.name + ' | type: ' + a.type + ' | size: ' + a.size);
  }

  await connection.close();
}
main().catch(console.error);
