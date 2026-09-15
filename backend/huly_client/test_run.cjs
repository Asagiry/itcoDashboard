const { connect, connectRest, NodeWebSocketFactory, markdown } = require('@hcengineering/api-client');

const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHRyYSI6eyJhdXRoTWV0aG9kIjoicGFzc3dvcmQifSwiYWNjb3VudCI6ImZmOWVhNjI2LTFmNzItNGUyZS04N2ZlLTczMmVlMTlkYTYzOSIsIndvcmtzcGFjZSI6ImM3MTE1ZjFhLTkxNDQtNDdmMy05Y2M1LTE1NmNkY2RiN2YwYyJ9.y5ayKujBQUR2TWWiuAfxrXxZ4rBn4N_pgV2BpAIu25A';

async function main() {
  console.log('Connecting to https://tracker.itco.su via @hcengineering/api-client...');
  try {
    const client = await connect('https://tracker.itco.su', {
      token: token,
      workspace: 'c7115f1a-9144-47f3-9cc5-156cdcdb7f0c',
      socketFactory: NodeWebSocketFactory,
      connectionTimeout: 10000
    });

    console.log('Connected! Querying issues...');
    const issues = await client.findAll('tracker:class:Issue', {});
    console.log('TOTAL ISSUES FOUND:', issues.length);

    if (issues.length > 0) {
      console.log('FIRST 3 ISSUES:');
      for (const iss of issues.slice(0, 3)) {
        console.log('--- Issue ---');
        console.log('ID:', iss._id);
        console.log('Identifier:', iss.identifier);
        console.log('Title:', iss.title);
        console.log('Status:', iss.status);
        console.log('Assignee:', iss.assignee);
        console.log('Description type/val:', typeof iss.description, (typeof iss.description === 'string' ? iss.description.substring(0, 80) : iss.description));
        console.log('Attachments:', iss.attachments);
      }
    }

    const projects = await client.findAll('tracker:class:Project', {});
    console.log('TOTAL PROJECTS FOUND:', projects.length);
    for (const p of projects) {
      console.log('Project:', p._id, p.name, p.identifier);
    }

    await client.close();
  } catch (err) {
    console.error('API Error:', err);
  }
}

main();
