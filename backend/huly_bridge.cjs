
const fs = require('fs');
const path = require('path');
const https = require('https');

// Mute console warnings from internal engine libraries during JSON output
const originalWarn = console.warn;
console.warn = () => {};

const hulyClientDir = path.join(__dirname, 'huly_client');
const apiModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'api-client'));
const platformModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'platform'));
const coreModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'core'));
const clientPkg = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'client'));
const clientResourcesPkg = path.join(hulyClientDir, 'node_modules', '@hcengineering', 'client-resources');
const collabClientModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'collaborator-client'));
const accountClientModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'account-client'));
const textModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'text'));
const textMarkdownModule = require(path.join(hulyClientDir, 'node_modules', '@hcengineering', 'text-markdown'));

const { loadServerConfig, NodeWebSocketFactory } = apiModule;
const { getResource, addLocation } = platformModule;
const { TxOperations } = coreModule;
const { getClient: getCollabClient } = collabClientModule;
const { getClient: getAccountClient } = accountClientModule;
const { markupToJSON } = textModule;
const { markupToMarkdown } = textMarkdownModule;

const HULY_URL = 'https://tracker.itco.su';
const HULY_WS = 'wss://tracker.itco.su/_transactor';
const ACCOUNTS_URL = 'https://tracker.itco.su/_accounts';
const WORKSPACE = 'c7115f1a-9144-47f3-9cc5-156cdcdb7f0c';
const MEDIA_BASE = path.join(__dirname, 'media', 'attachments');

const STATUS_TO_ID = {
  'todo': 'tracker:status:Todo',
  'in_progress': 'tracker:status:InProgress',
  'review': '69f9bb5a112005c7f3bf3c72',
  'ready_for_testing': '6aa3c483f404981b798206bf',
  'testing': '6aa3c483f404981b798206bf',
  'ready_to_merge': '6a3f80269e8c40247bc05811'
};

const ID_TO_STATUS = {
  'tracker:status:Backlog': 'todo',
  'tracker:status:Todo': 'todo',
  'tracker:status:InProgress': 'in_progress',
  '69f9bb5a112005c7f3bf3c72': 'review',
  '6aa3c483f404981b798206bf': 'ready_for_testing',
  '6a3f80269e8c40247bc05811': 'ready_to_merge',
  'tracker:status:Done': 'ready_to_merge',
  'tracker:status:Resolved': 'ready_to_merge',
  'tracker:status:Canceled': 'ready_to_merge'
};

function downloadFile(fileUrl, destPath, authToken) {
  return new Promise((resolve) => {
    if (fs.existsSync(destPath)) {
      return resolve(true);
    }
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const req = https.get(fileUrl, {
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'User-Agent': 'Mozilla/5.0 ITCO-Dashboard'
      },
      timeout: 8000
    }, (res) => {
      if (res.statusCode === 200) {
        const stream = fs.createWriteStream(destPath);
        res.pipe(stream);
        stream.on('finish', () => { stream.close(); resolve(true); });
        stream.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function loginUser(email, password) {
  const accClient = getAccountClient(ACCOUNTS_URL);
  const loginInfo = await accClient.login(email, password);
  if (!loginInfo || !loginInfo.token) {
    throw new Error('Не удалось войти в аккаунт Huly.');
  }

  const wsClient = getAccountClient(ACCOUNTS_URL, loginInfo.token);
  const wsInfo = await wsClient.selectWorkspace('itco');
  if (!wsInfo || !wsInfo.token) {
    throw new Error('Не удалось выбрать рабочее пространство itco.');
  }

  return {
    success: true,
    token: wsInfo.token,
    account: wsInfo.account,
    workspace: wsInfo.workspace,
    email: email
  };
}

async function getClient(token, accountId) {
  addLocation(clientPkg.clientId, () => Promise.resolve(require(clientResourcesPkg)));
  const clientFactory = await getResource(clientPkg.default.function.GetClient);
  const connection = await clientFactory(token, HULY_WS, {
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 15000
  });
  const tx = new TxOperations(connection, accountId || 'ff9ea626-1f72-4e2e-87fe-732ee19da639');
  return { connection, tx };
}

async function syncTracker(token, accountId) {
  const { connection, tx } = await getClient(token, accountId);
  const config = await loadServerConfig(HULY_URL);
  const collab = getCollabClient(WORKSPACE, token, config.COLLABORATOR_URL);

  // 1. Projects
  const rawProjects = await tx.findAll('tracker:class:Project', {});
  const projects = rawProjects.map(p => ({
    id: (p.identifier || p._id).toLowerCase(),
    key: p.identifier || p.name || 'ITCO',
    name: p.name || p.identifier || 'ITCO',
    description: p.description || '',
    color: '#3b82f6'
  }));

  // 2. Identify user Person ID
  const allPersons = await tx.findAll('contact:class:Person', {});
  const userPerson = allPersons.find(p => {
    const emailList = (p.emails || []).concat(p.email ? [p.email] : []);
    return emailList.some(e => e && e.toLowerCase().includes('vepishin'));
  });
  const userPersonId = userPerson ? userPerson._id : '6a969554b09b44d03f62d9f7';

  // 3. User issues
  const allIssues = await tx.findAll('tracker:class:Issue', {});
  const userIssues = allIssues.filter(i => i.assignee === userPersonId);
  const userIssueIds = new Set(userIssues.map(i => i._id));

  // 4. Attachments
  const allAttachments = await tx.findAll('attachment:class:Attachment', {});
  const attachMap = {};
  for (const a of allAttachments) {
    if (userIssueIds.has(a.attachedTo)) {
      if (!attachMap[a.attachedTo]) attachMap[a.attachedTo] = [];
      attachMap[a.attachedTo].push(a);
    }
  }

  // 5. Fetch descriptions & download attachments in parallel
  const issues = await Promise.all(userIssues.map(async (iss) => {
    const key = iss.identifier || ('МКС-' + iss.number);
    let desc = '';
    if (iss.description) {
      try {
        const collabId = 'tracker:class:Issue:' + iss._id + ':description';
        const rawMarkup = await collab.getMarkup(collabId, iss.description);
        if (rawMarkup) {
          const json = markupToJSON(rawMarkup);
          desc = markupToMarkdown(json, { refUrl: '', imageUrl: '' }) || '';
        }
      } catch (err) {}
    }

    // Clean description
    desc = desc.replace(/image\.(?:png|jpg|jpeg)\s+[\d\.]+\s*(?:kB|MB|B)\s*•\s*Download\s*•\s*Delete/gi, '').trim();
    desc = desc.replace(/[\w\.\-]+\.(?:exe|png|jpg|jpeg|pdf|zip)\s+[\d\.]+\s*(?:kB|MB|B)\s*•\s*Download(?:\s*•\s*Delete)?/gi, '').trim();

    // Attachments
    const issueAttaches = attachMap[iss._id] || [];
    const localAttachments = [];
    for (const a of issueAttaches) {
      const fileId = a.file || a._id;
      const fn = fileId.substring(0, 12) + '.png';
      const fileUrl = HULY_URL + '/files/' + WORKSPACE + '/' + encodeURIComponent(a.name || 'image.png') + '?file=' + fileId + '&workspace=' + WORKSPACE;
      const dest = path.join(MEDIA_BASE, key, fn);
      await downloadFile(fileUrl, dest, token);
      localAttachments.push('/api/tracker/attachments/' + key + '/' + fn);
    }

    const normStatus = ID_TO_STATUS[iss.status] || 'todo';
    const projKey = iss.identifier ? iss.identifier.split('-')[0] : 'МКС';

    return {
      id: iss._id,
      key: key,
      title: iss.title || key,
      description: desc,
      project_id: projKey.toLowerCase(),
      project_key: projKey,
      project_name: projKey,
      status: normStatus,
      assignee: 'vepishin@it-co.ru',
      priority: iss.priority === 1 ? 'urgent' : 'normal',
      component: '',
      milestone: '',
      is_bug: iss.kind && iss.kind.toLowerCase().includes('bug') ? 1 : 0,
      time_spent: iss.reportedTime ? (iss.reportedTime + 'h') : '',
      comments_count: iss.comments || 0,
      attachments_count: localAttachments.length,
      attachments_json: JSON.stringify(localAttachments),
      tracker_url: HULY_URL + '/workbench/itco/tracker/' + encodeURIComponent(key),
      raw_data: JSON.stringify(iss)
    };
  }));

  await connection.close();
  return { success: true, projects, issues, count: issues.length };
}

async function updateStatus(token, accountId, issueKey, targetStatus) {
  const { connection, tx } = await getClient(token, accountId);
  const allIssues = await tx.findAll('tracker:class:Issue', {});
  const target = allIssues.find(i => i.identifier === issueKey || i._id === issueKey);
  if (!target) {
    await connection.close();
    return { success: false, message: 'Задача ' + issueKey + ' не найдена в Huly' };
  }

  const newStatusId = STATUS_TO_ID[targetStatus] || targetStatus;
  await tx.updateDoc('tracker:class:Issue', target._id, { status: newStatusId });
  await connection.close();
  return { success: true, key: issueKey, newStatus: targetStatus, statusId: newStatusId };
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'sync';

  try {
    if (cmd === 'login') {
      const email = args[1];
      const password = args[2];
      const result = await loginUser(email, password);
      console.log(JSON.stringify(result));
    } else if (cmd === 'sync') {
      const token = args[1];
      const accountId = args[2];
      if (!token) throw new Error('Token is required for sync');
      const result = await syncTracker(token, accountId);
      console.log(JSON.stringify(result));
    } else if (cmd === 'update_status') {
      const token = args[1];
      const accountId = args[2];
      const issueKey = args[3];
      const newStatus = args[4];
      if (!token) throw new Error('Token is required for update_status');
      const result = await updateStatus(token, accountId, issueKey, newStatus);
      console.log(JSON.stringify(result));
    } else {
      throw new Error('Unknown command ' + cmd);
    }
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

main();
