const API_ROOT = 'https://api.github.com';
const MAX_BYTES = 4 * 1024 * 1024;

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

async function findExistingSha(path, config) {
  const url = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath(path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await githubFetch(url, config, { method: 'GET' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub metadata request failed with ${response.status}.`);
  const data = await response.json().catch(() => ({}));
  return data.sha || null;
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

  const filename = safeFilename(payload.filename);
  let content = String(payload.content || '').replace(/^data:[^,]+,/, '');
  if (!filename) return json(400, { error: 'The generated filename was not valid.' });
  if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || content.length % 4 === 1) {
    return json(400, { error: 'The image data was not valid base64.' });
  }

  let bytes;
  try {
    bytes = Buffer.from(content, 'base64');
  } catch (error) {
    return json(400, { error: 'The image could not be decoded.' });
  }
  if (!bytes.length) return json(400, { error: 'The image was empty.' });
  if (bytes.length > MAX_BYTES) return json(413, { error: 'The compressed image is over 4 MB.' });

  const path = config.folder ? `${config.folder}/${filename}` : filename;
  try {
    const sha = await findExistingSha(path, config);
    const url = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath(path)}`;
    const response = await githubFetch(url, config, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Upload camera photo ${filename}`,
        content,
        branch: config.branch,
        ...(sha ? { sha } : {})
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) return json(502, { error: 'GitHub rejected GITHUB_TOKEN. Create a new fine-grained token with Contents: Read and write.' });
      if (response.status === 403) return json(502, { error: 'GitHub denied the write. Check that the token has Contents: Read and write permission.' });
      if (response.status === 404) return json(502, { error: 'The configured repository or branch was not found.' });
      if (response.status === 409) return json(409, { error: 'GitHub reported a branch conflict. Try the upload again.' });
      return json(502, { error: data.message || `GitHub returned ${response.status}.` });
    }

    return json(200, {
      ok: true,
      path,
      url: data?.content?.html_url || `https://github.com/${config.owner}/${config.repo}/blob/${encodeURIComponent(config.branch)}/${encodedPath(path)}`
    });
  } catch (error) {
    return json(502, { error: error.message || 'The upload function could not reach GitHub.' });
  }
};
