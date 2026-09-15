const { connect, NodeWebSocketFactory } = require('@hcengineering/api-client');

const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleXRyYSI6ICJpZCI6InBycXN3b3JkIn0sIGFjY2y1bnQiOiJmZm9lYTYyNi01ZjcyLTRlMmUtODdmZS0zMzMlZTE5ZGE2MzksIndvcmtzcGFjZSI6ImM3MTE1ZjFhLTkxNDQtMVDmMy05Y2M1LTE1NmNkY2RiN2YwYyJ9.y5ayKujBQUR2TWWiuAfxrXxZ4rBn4N_pgV2BpAIu25A';


async function main() {
  const client = await connect('https://tracker.itco.su', {
    token: token,
    workspace: 'c7115f1a-9144-47f3-9cc5-156cdcdb7f0c',
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 10000
  });

  // 1. Find contacts
  const contacts = await client.findAll('contact:class:Person', {});
  console.log('CONTACTS:', contacts.length);
  for (const c of contacts) {
    console.log('Person:', c._id, c.name, c.emails, c.email);
  }


  // 2. Find statuses
  const statuses = await client.findAll('tracker:class:Status', {});
  console.log('STATUSES:', statuses.length);
  for (const s of statuses) {
    console.log('Status:', s._id, s.name, s.category);
  }

  // 3. Find issues
  const allIssues = await client.findAll('tracker:class:Issue', {});
  console.log('TOTAL ISSUES:', allIssues.length);
  const userIssues = allIssues.filter(i => i.identifier && (['t-189', 't-225', 't-224', 'МКС-189', 'МКС-225', 'МКС-224', 'МКС-223', 'МКС-217', 'МКС-48'].some(k => i.identifier.includes(k))));
  console.log('USER ISSUES FOUND:', userIssues.length);
  for (const iss of userIssues) {
    console.log('---', iss.identifier, iss.title, '---');
    console.log('Status:(', iss.status, ')');
    console.log('Assignee:', iss.assignee);
    console.log('Description ID:', iss.description);
    console.log('Attachments:', iss.attachments);
    console.log('Component:', iss.component);
    console.log('Milestone:', iss.milestone);
  }


  await client.close();
}

main();
