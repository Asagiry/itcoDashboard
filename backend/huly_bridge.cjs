
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
const { TxOperations, pickPrimarySocialId } = coreModule;
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
  'testing': '69f9bb44112005c7f3bf3c6a',
  'ready_to_merge': '69fa066535e6ece6dbd474d2',
  'ready_for_production': '6a3f80269e8c40247bc05811',
  'done': 'tracker:status:Done'
};

const ID_TO_STATUS = {
  'tracker:status:Backlog': 'todo',
  'tracker:status:Todo': 'todo',
  'tracker:status:InProgress': 'in_progress',
  '69f9bb5a112005c7f3bf3c72': 'review',
  '6aa3c483f404981b798206bf': 'ready_for_testing',
  '69f9bb44112005c7f3bf3c6a': 'testing',
  '6a0c39a0364f2924b2573c25': 'testing',
  '69fa066535e6ece6dbd474d2': 'ready_to_merge',
  '6a3f80269e8c40247bc05811': 'ready_for_production',
  'tracker:status:Done': 'ready_for_production',
  'tracker:status:Resolved': 'ready_for_production',
  'tracker:status:Canceled': 'ready_for_production',
  '69f9c1c3112005c7f3bf440c': 'ready_for_production',
  '69f9cbcc112005c7f3bf50c6': 'ready_for_production'
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
  let primarySocialId = '1206170148776181761';
  try {
    const config = await loadServerConfig(HULY_URL);
    const accountClient = getAccountClient(config.ACCOUNTS_URL, token);
    const socialIds = await accountClient.getSocialIds(true);
    if (socialIds && socialIds.length > 0) {
      primarySocialId = pickPrimarySocialId(socialIds)._id;
    }
  } catch (err) {}

  addLocation(clientPkg.clientId, () => Promise.resolve(require(clientResourcesPkg)));
  const clientFactory = await getResource(clientPkg.default.function.GetClient);
  const connection = await clientFactory(token, HULY_WS, {
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 15000
  });
  const tx = new TxOperations(connection, primarySocialId);
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

  // 3. User issues (filter out ready for production & completed/cancelled)
  const EXCLUDED_STATUS_IDS = new Set([
    '6a3f80269e8c40247bc05811', // Ready for Production
    'tracker:status:Done',
    'tracker:status:Resolved',
    'tracker:status:Canceled',
    '69f9c1c3112005c7f3bf440c',
    '69f9cbcc112005c7f3bf50c6'
  ]);

  const allIssues = await tx.findAll('tracker:class:Issue', {});
  const userIssues = allIssues.filter(i => {
    if (i.assignee !== userPersonId) return false;
    if (EXCLUDED_STATUS_IDS.has(i.status)) return false;
    if (ID_TO_STATUS[i.status] === 'ready_for_production') return false;
    return true;
  });
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
        const doc = {
          objectClass: 'tracker:class:Issue',
          objectId: iss._id,
          objectAttr: 'description'
        };
        const rawMarkup = await collab.getMarkup(doc, iss.description);
        if (rawMarkup) {
          const json = markupToJSON(rawMarkup);
          desc = markupToMarkdown(json, { refUrl: '', imageUrl: '' }) || '';
        }
      } catch (err) {}
    }

    // Clean HTML spans
    desc = desc.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '');

    // Attachments from attachment objects
    const issueAttaches = attachMap[iss._id] || [];
    const localAttachments = [];
    const fileIdToLocalUrl = {};

    for (const a of issueAttaches) {
      const fileId = a.file || a._id;
      const fn = fileId.substring(0, 12) + '.png';
      const fileUrl = HULY_URL + '/files/' + WORKSPACE + '/' + encodeURIComponent(a.name || 'image.png') + '?file=' + fileId + '&workspace=' + WORKSPACE;
      const dest = path.join(MEDIA_BASE, key, fn);
      await downloadFile(fileUrl, dest, token);
      const localUrl = '/api/tracker/attachments/' + key + '/' + fn;
      localAttachments.push(localUrl);
      fileIdToLocalUrl[fileId] = localUrl;
    }

    // Check for any inline image references in description
    const inlineImgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = inlineImgRegex.exec(desc)) !== null) {
      const rawTarget = match[2];
      const fileId = rawTarget.split('&')[0].split('?')[0].trim();
      if (fileId && fileId.length >= 8 && !fileIdToLocalUrl[fileId]) {
        const fn = fileId.substring(0, 12) + '.png';
        const fileUrl = HULY_URL + '/files/' + WORKSPACE + '/image.png?file=' + fileId + '&workspace=' + WORKSPACE;
        const dest = path.join(MEDIA_BASE, key, fn);
        await downloadFile(fileUrl, dest, token);
        const localUrl = '/api/tracker/attachments/' + key + '/' + fn;
        if (!localAttachments.includes(localUrl)) {
          localAttachments.push(localUrl);
        }
        fileIdToLocalUrl[fileId] = localUrl;
      }
    }

    // Replace inline markdown image references with local URLs and ensure proper newline separation
    desc = desc.replace(/!\[([^\]]*)\]\(([^)&"'\s]+)(?:[^\)]*)?\)/g, (m, alt, fileId) => {
      const cleanId = fileId.split('&')[0].split('?')[0].trim();
      const localUrl = fileIdToLocalUrl[cleanId] || ('/api/tracker/attachments/' + key + '/' + cleanId.substring(0, 12) + '.png');
      return `\n\n![${alt || 'Скриншот'}](${localUrl})\n\n`;
    });

    // Clean technical download boilerplate
    desc = desc.replace(/image\.(?:png|jpg|jpeg)\s+[\d\.]+\s*(?:kB|MB|B)\s*•\s*Download\s*•\s*Delete/gi, '').trim();
    desc = desc.replace(/[\w\.\-]+\.(?:exe|png|jpg|jpeg|pdf|zip)\s+[\d\.]+\s*(?:kB|MB|B)\s*•\s*Download(?:\s*•\s*Delete)?/gi, '').trim();
    desc = desc.replace(/\\$/gm, '');
    desc = desc.replace(/\\n/g, '\n');

    // Format labels: Вопрос:, Ответ:, ОР:, ФР:
    desc = desc.replace(/^(ОР[\.:]?|ОР\s*-|Ожидаемый результат:?)\s*/gim, '**ОР:** ');
    desc = desc.replace(/^(ФР[\.:]?|ФР\s*-|Фактический результат:?)\s*/gim, '**ФР:** ');
    desc = desc.replace(/^(вопрос:?)\s*/gim, '**Вопрос:** ');
    desc = desc.replace(/^(ответ:?)\s*/gim, '**Ответ:** ');

    // Normalize hard wraps inside paragraphs
    const paragraphs = desc.split(/\n{2,}/);
    const cleanedParas = paragraphs.map(p => {
      const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return '';
      
      const isList = lines.every(l => /^(\d+\.|[-*•]|!\[)/.test(l));
      if (isList) return lines.join('\n');
      
      let result = [];
      let currentText = [];
      for (const line of lines) {
        if (/^(\d+\.|[-*•]|!\[)/.test(line)) {
          if (currentText.length > 0) {
            result.push(currentText.join(' '));
            currentText = [];
          }
          result.push(line);
        } else {
          currentText.push(line);
        }
      }
      if (currentText.length > 0) {
        result.push(currentText.join(' '));
      }
      return result.join('\n');
    });

    desc = cleanedParas.filter(Boolean).join('\n\n').trim();

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
  await tx.updateDoc('tracker:class:Issue', target.space, target._id, { status: newStatusId });
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
