const API_ROOT = 'https://api.github.com';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    folder: process.env.GITHUB_FOLDER || ''
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });

  const config = settings();
  if (!config.token) return json(500, { error: 'GITHUB_TOKEN is not configured in Netlify.' });

  try {
    const response = await fetch(`${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'snapline-netlify-function'
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) return json(502, { error: 'GitHub rejected GITHUB_TOKEN. Create a new fine-grained token with Contents: Read and write.' });
      if (response.status === 403) return json(502, { error: 'GitHub denied access. Check the token permission and repository access.' });
      if (response.status === 404) return json(502, { error: `GitHub could not find ${config.owner}/${config.repo}.` });
      return json(502, { error: data.message || `GitHub returned ${response.status}.` });
    }
    return json(200, {
      ok: true,
      repository: data.full_name,
      branch: config.branch,
      folder: config.folder
    });
  } catch (error) {
    return json(502, { error: 'The upload function could not reach GitHub.' });
  }
};
