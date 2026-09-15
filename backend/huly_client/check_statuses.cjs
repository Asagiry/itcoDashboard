
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

  const hierarchy = tx.getHierarchy();
  console.log('ALL CLASSES:', Object.keys(hierarchy.classes).filter(c => c.includes('Status') || c.includes('status') || c.includes('tracker') || c.includes('workflow') || c.includes('Workflow')));

  for (const statusId of ['6aa3c483f404981b798206bf', '6a3f80269e8c40247bc05811', '69f9bb5a112005c7f3bf3c72']) {
    try {
      const doc = await tx.findOne('core:class:Doc', { _id: statusId });
      console.log('Doc for ' + statusId + ':', doc);
    } catch(e) {}
  }

  // Also query tracker:class:IssueStatus or tracker:class:Workflow or process:class:State
  for (const cls of ['tracker:class:IssueStatus', 'tracker:class:Workflow', 'process:class:State', 'core:class:Status']) {
    try {
      const res = await tx.findAll(cls, {});
      console.log(cls + ' (' + res.length + '):', res);
    } catch(e) {}
  }

  await connection.close();
}
main().catch(console.error);
