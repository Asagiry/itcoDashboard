import { connect, connectRest, NodeWebSocketFactory } from '@hcengineering/api-client';

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

    console.log('Connected successfully! Fetching issues...');
    const issues = await client.findAll('tracker:class:Issue', {});
    console.log('Fetched ' + issues.length + ' issues!');
    if (issues.length > 0) {
      console.log('Sample issue:', JSON.stringify(issues[0], null, 2));
    }

    const projects = await client.findAll('tracker:class:Project', {});
    console.log('Fetched ' + projects.length + ' projects!');

    await client.close();
  } catch (err) {
    console.error('Connection error:', err);
  }
}

main();
