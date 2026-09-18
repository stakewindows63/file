const API_ROOT = 'https://api.github.com';
const MAX_BYTES = 3.5 * 1024 * 1024;
const MAX_FILES = 12;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

function settings() {
  return {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER || 'stakewindows63',
    repo: process.env.GITHUB_REPO || 'file',
    branch: process.env.GITHUB_BRANCH || 'main',
    folder: String(process.env.GITHUB_FOLDER || '').trim().replace(/^\/+|\/+$/g, '')
  };
}

function safeFilename(value) {
  const filename = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(filename) && !filename.includes('..') ? filename : null;
}

function encodedPath(path) {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function githubFetch(url, config, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'snapline-netlify-function',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

async function githubJson(url, config, options = {}) {
  const response = await githubFetch(url, config, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `GitHub returned ${response.status}.`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function createCommit(files, config) {
  const refUrl = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/refs/heads/${encodeURIComponent(config.branch)}`;
  const ref = await githubJson(refUrl, config);
  const parentCommitSha = ref.object?.sha;
  if (!parentCommitSha) throw new Error('The configured branch does not have a commit yet.');

  const parentCommit = await githubJson(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/commits/${parentCommitSha}`, config);
  const entries = [];
  for (const file of files) {
    const blob = await githubJson(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs`, config, {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'base64' })
    });
    entries.push({
      path: config.folder ? `${config.folder}/${file.filename}` : file.filename,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }

  const tree = await githubJson(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees`, config, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: entries })
  });
  const commit = await githubJson(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/commits`, config, {
    method: 'POST',
    body: JSON.stringify({
      message: `Upload ${files.length} camera photo${files.length === 1 ? '' : 's'}`,
      tree: tree.sha,
      parents: [parentCommitSha]
    })
  });
  await githubJson(refUrl, config, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { commit, entries };
}

function errorResponse(error) {
  if (error.status === 401) return json(502, { error: 'GitHub rejected GITHUB_TOKEN. Create a new fine-grained token with Contents: Read and write.' });
  if (error.status === 403) return json(502, { error: 'GitHub denied the write. Check the token permission and repository access.' });
  if (error.status === 404) return json(502, { error: 'The configured repository or branch was not found.' });
  if (error.status === 409) return json(409, { error: 'GitHub branch changed while uploading. Please try the batch again.' });
  return json(502, { error: error.message || 'The upload function could not reach GitHub.' });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  const config = settings();
  if (!config.token) return json(500, { error: 'GITHUB_TOKEN is not configured in Netlify.' });

  let payload;
  try {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '{}';
    payload = JSON.parse(rawBody);
  } catch (error) {
    return json(400, { error: 'The upload request was not valid JSON.' });
  }

  const incoming = Array.isArray(payload.files) ? payload.files : [];
  if (!incoming.length) return json(400, { error: 'Choose at least one image.' });
  if (incoming.length > MAX_FILES) return json(400, { error: `Choose no more than ${MAX_FILES} images per batch.` });

  const files = [];
  let totalBytes = 0;
  for (const item of incoming) {
    const filename = safeFilename(item.filename);
    const content = String(item.content || '').replace(/^data:[^,]+,/, '');
    if (!filename) return json(400, { error: 'One of the generated filenames was not valid.' });
    if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || content.length % 4 === 1) {
      return json(400, { error: 'One of the image payloads was not valid base64.' });
    }
    const bytes = Buffer.from(content, 'base64');
    if (!bytes.length) return json(400, { error: 'One of the selected images was empty.' });
    totalBytes += bytes.length;
    files.push({ filename, content, bytes: bytes.length });
  }
  if (totalBytes > MAX_BYTES) return json(413, { error: 'This batch is too large. Select fewer photos or try smaller images.' });

  try {
    // One Git tree and one commit avoids the branch conflicts caused by parallel Contents API PUTs.
    let result;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await createCommit(files, config);
        break;
      } catch (error) {
        lastError = error;
        if (error.status !== 409 || attempt === 1) throw error;
      }
    }
    if (!result) throw lastError || new Error('The batch commit was not created.');

    const responseFiles = files.map((file) => {
      const path = config.folder ? `${config.folder}/${file.filename}` : file.filename;
      return {
        name: file.filename,
        path,
        url: `https://github.com/${config.owner}/${config.repo}/blob/${encodeURIComponent(config.branch)}/${encodedPath(path)}`
      };
    });
    return json(200, { ok: true, commitUrl: result.commit.html_url, files: responseFiles });
  } catch (error) {
    return errorResponse(error);
  }
};
