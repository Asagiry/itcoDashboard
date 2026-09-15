
const { loadServerConfig, NodeWebSocketFactory } = require('@hcengineering/api-client');
const { getResource, addLocation } = require('@hcengineering/platform');
const { TxOperations } = require('@hcengineering/core');
const clientPkg = require('@hcengineering/client');
const { getClient: getCollabClient } = require('@hcengineering/collaborator-client');
const { markupToJSON } = require('@hcengineering/text');
const { markupToMarkdown } = require('@hcengineering/text-markdown');

const url = 'https://tracker.itco.su';
const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHRyYSI6eyJhdXRoTWV0aG9kIjoicGFzc3dvcmQifSwiYWNjb3VudCI6ImZmOWVhNjI2LTFmNzItNGUyZS04N2ZlLTczMmVlMTlkYTYzOSIsIndvcmtzcGFjZSI6ImM3MTE1ZjFhLTkxNDQtNDdmMy05Y2M1LTE1NmNkY2RiN2YwYyJ9.y5ayKujBQUR2TWWiuAfxrXxZ4rBn4N_pgV2BpAIu25A';
const workspace = 'c7115f1a-9144-47f3-9cc5-156cdcdb7f0c';
const endpoint = 'wss://tracker.itco.su/_transactor';

async function main() {
  const t0 = Date.now();
  console.log('Starting direct Huly API sync...');

  addLocation(clientPkg.clientId, () => {
    return Promise.resolve(require('@hcengineering/client-resources'));
  });

  const clientFactory = await getResource(clientPkg.default.function.GetClient);
  const connection = await clientFactory(token, endpoint, {
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 10000
  });

  const tx = new TxOperations(connection, 'ff9ea626-1f72-4e2e-87fe-732ee19da639');
  const config = await loadServerConfig(url);
  const collab = getCollabClient(workspace, token, config.COLLABORATOR_URL);

  // 1. Fetch all issues
  const allIssues = await tx.findAll('tracker:class:Issue', {});
  console.log('Total issues fetched:', allIssues.length, 'in', (Date.now() - t0), 'ms');

  // 2. Inspect classes related to status or workflow
  const allProjects = await tx.findAll('tracker:class:Project', {});
  console.log('Total projects:', allProjects.length);

  // 3. Filter issues assigned to Vladimir Epishin (6a969554b09b44d03f62d9f7)
  const myIssues = allIssues.filter(i => i.assignee === '6a969554b09b44d03f62d9f7');
  console.log('Issues assigned to Vladimir Epishin:', myIssues.length);

  for (const iss of myIssues) {
    let descText = '';
    if (iss.description) {
      try {
        const collabId = 'tracker:class:Issue:' + iss._id + ':description';
        const rawMarkup = await collab.getMarkup(collabId, iss.description);
        if (rawMarkup) {
          const json = markupToJSON(rawMarkup);
          descText = markupToMarkdown(json, { refUrl: '', imageUrl: '' }) || '';
        }
      } catch (err) {
      }
    }
    const title = (iss.title || '').substring(0, 35);
    const descPrev = (descText || '').substring(0, 45).replace(/\n/g, ' ');
    console.log('[' + iss.identifier + '] status: ' + iss.status + ' | title: ' + title + ' | desc len: ' + descText.length + ' (' + descPrev + ')');
  }

  await connection.close();
  console.log('🎉 Completed entire direct API sync in', (Date.now() - t0), 'ms!');
}

main().catch(console.error);
