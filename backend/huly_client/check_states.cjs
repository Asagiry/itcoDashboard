
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

  for (const c of ['process:class:State', 'process:class:Workflow', 'tracker:class:Component', 'tracker:class:Milestone', 'tracker:class:IssueType']) {
    try {
      const items = await tx.findAll(c, {});
      console.log(c, '(' + items.length + '):');
      for (const it of items) {
        console.log('  ', it._id, it.name || it.title || it._class, it.category || '');
      }
    } catch(e) {
      console.log('Err for', c, e.message);
    }
  }

  await connection.close();
}
main().catch(console.error);
