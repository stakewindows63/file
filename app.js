const API_ROOT = 'https://api.github.com';
const CONFIG_KEY = 'snapline_config_v1';
const ACTIVITY_KEY = 'snapline_activity_v1';
const MAX_BYTES = 10 * 1024 * 1024;
const EMBEDDED_CONFIG = (() => {
  const value = window.SNAPLINE_CONFIG;
  if (!value?.owner || !value?.repo || !value?.token || value.token.includes('PASTE_YOUR_NEW')) return null;
  return {
    repo: `${value.owner}/${value.repo}`,
    branch: value.branch || 'main',
    folder: value.folder || 'camera/',
    token: value.token
  };
})();

const $ = (selector) => document.querySelector(selector);
const cameraInput = $('#camera-input');
const captureStage = $('#capture-stage');
const emptyCapture = $('#empty-capture');
const photoCapture = $('#photo-capture');
const photoPreview = $('#photo-preview');
const selectedFileName = $('#selected-file-name');
const selectedFileSize = $('#selected-file-size');
const previewResolution = $('#preview-resolution');
const captureState = $('#capture-state');
const publishButton = $('#publish-photo');
const settingsModal = $('#settings-modal');
const helpModal = $('#help-modal');
const settingsForm = $('#settings-form');
const settingsError = $('#settings-error');

let selectedFile = null;
let selectedDataUrl = '';
let savedConfig = null;
let transientConfig = null;
let previewObjectUrl = '';

function getStoredConfig() {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function getActivity() {
  try {
    const value = localStorage.getItem(ACTIVITY_KEY);
    return value ? JSON.parse(value) : [];
  } catch (error) {
    return [];
  }
}

function setActivity(items) {
  try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, 12))); } catch (error) { /* private mode can block storage */ }
}

function currentConfig() {
  return transientConfig || savedConfig;
}

function normaliseFolder(folder) {
  return String(folder || '').trim().replace(/^\/+|\/+$/g, '');
}

function repoParts(repo) {
  const clean = String(repo || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.length === 2 ? parts : null;
}

function repoLabel(repo) {
  const parts = repoParts(repo);
  return parts ? `${parts[0]} / ${parts[1]}` : 'Connect a repository';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function slugifyFileName(mime = '') {
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const stamp = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const datePart = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}-${String(stamp.getMilliseconds()).padStart(3, '0')}`;
  return `photo-${datePart}.${extension}`;
}

function setBusy(button, busy, labelSelector, busyLabel) {
  const label = button.querySelector(labelSelector);
  const spinner = button.querySelector('.button-spinner');
  if (busy) {
    button.disabled = true;
    if (label) {
      if (!button.dataset.originalLabel) button.dataset.originalLabel = label.textContent;
      label.textContent = busyLabel;
    }
    spinner?.classList.remove('hidden');
  } else {
    button.disabled = false;
    if (label && button.dataset.originalLabel) label.textContent = button.dataset.originalLabel;
    delete button.dataset.originalLabel;
    spinner?.classList.add('hidden');
  }
}

function showToast(message, type = 'info', duration = 4500) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const mark = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
  toast.innerHTML = `<span class="toast-mark">${mark}</span><span>${escapeHtml(message)}</span>`;
  $('#toast-stack').appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(5px)';
    window.setTimeout(() => toast.remove(), 220);
  }, duration);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function openModal(modal) {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const focusable = modal.querySelector('input, button');
  window.setTimeout(() => focusable?.focus(), 25);
}

function closeModal(modal) {
  modal.classList.add('hidden');
  if (settingsModal.classList.contains('hidden') && helpModal.classList.contains('hidden')) document.body.style.overflow = '';
}

function updateConnectionUI() {
  const config = currentConfig();
  const chip = $('#connection-chip');
  const label = $('#connection-label');
  const repoName = $('#repo-name');
  const repoPath = $('#repo-path');
  const repoState = $('#repo-state');
  const branchValue = $('#branch-value');
  const folderValue = $('#folder-value');
  const connectButtonLabel = document.querySelector('.connect-button-label');

  if (config && repoParts(config.repo)) {
    chip.classList.add('connected');
    label.textContent = repoLabel(config.repo);
    repoName.textContent = repoLabel(config.repo);
    repoPath.textContent = `${normaliseFolder(config.folder) || 'root'}/capture.jpg`;
    repoState.textContent = 'ready';
    repoState.classList.add('online');
    branchValue.textContent = config.branch || 'main';
    folderValue.textContent = normaliseFolder(config.folder) ? `${normaliseFolder(config.folder)}/` : '/';
    connectButtonLabel.textContent = 'Test connection';
  } else {
    chip.classList.remove('connected');
    label.textContent = 'Not connected';
    repoName.textContent = 'Connect a repository';
    repoPath.textContent = 'Images will appear here';
    repoState.textContent = 'offline';
    repoState.classList.remove('online');
    branchValue.textContent = 'main';
    folderValue.textContent = 'camera/';
    connectButtonLabel.textContent = 'Connect GitHub';
  }
}

function populateSettings() {
  const config = currentConfig() || {};
  $('#repo-input').value = config.repo || '';
  $('#branch-input').value = config.branch || 'main';
  $('#folder-input').value = config.folder ?? 'camera/';
  $('#token-input').value = config.token || '';
  $('#remember-input').checked = Boolean(savedConfig || !transientConfig);
  settingsError.classList.add('hidden');
  settingsError.textContent = '';
}

function openSettings() {
  populateSettings();
  openModal(settingsModal);
}

function readableError(error, response) {
  if (error?.message) return error.message;
  if (!response) return 'Something went wrong. Check your connection and try again.';
  if (response.status === 401) return 'GitHub rejected this token. Check that it is valid and has not expired.';
  if (response.status === 403) return 'GitHub denied the request. Check token permissions or your API rate limit.';
  if (response.status === 404) return 'Repository not found. Check the owner/name and token access.';
  if (response.status === 409) return 'GitHub found a branch conflict. Refresh the repository and try again.';
  return `GitHub returned ${response.status}. Check the repository settings and try again.`;
}

async function githubRequest(url, options = {}) {
  const config = currentConfig();
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(config?.token ? { Authorization: `Bearer ${config.token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(url, { ...options, headers });
  let data = null;
  try { data = await response.json(); } catch (error) { /* empty response */ }
  if (!response.ok) {
    const apiMessage = data?.message ? ` ${data.message}` : '';
    const err = new Error(`${response.status}${apiMessage}`);
    err.response = response;
    err.data = data;
    throw err;
  }
  return { response, data };
}

async function testConnection(config) {
  const parts = repoParts(config.repo);
  if (!parts) throw new Error('Enter a repository in owner/name format.');
  if (!config.token) throw new Error('Add a GitHub personal access token to write files.');
  const url = `${API_ROOT}/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
  const { data } = await githubRequest(url, { method: 'GET' });
  if (data?.permissions && data.permissions.push === false) {
    throw new Error('This token can read the repository, but it cannot push changes. Add Contents: write permission.');
  }
  return data;
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  settingsError.classList.add('hidden');
  const config = {
    repo: $('#repo-input').value.trim(),
    branch: $('#branch-input').value.trim() || 'main',
    folder: $('#folder-input').value.trim(),
    token: $('#token-input').value.trim()
  };
  const parts = repoParts(config.repo);
  if (!parts) {
    settingsError.textContent = 'Use the repository format owner/name, for example octocat/hello-world.';
    settingsError.classList.remove('hidden');
    return;
  }
  if (!config.token) {
    settingsError.textContent = 'A personal access token is required to create files in GitHub.';
    settingsError.classList.remove('hidden');
    return;
  }

  setBusy($('#save-settings'), true, '.save-label', 'Testing connection…');
  try {
    transientConfig = config;
    const repository = await testConnection(config);
    const remember = $('#remember-input').checked;
    if (remember) {
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (error) { showToast('Browser storage is unavailable; this connection will last until refresh.', 'info'); }
      savedConfig = config;
      transientConfig = null;
    } else {
      savedConfig = null;
      transientConfig = config;
      try { localStorage.removeItem(CONFIG_KEY); } catch (error) { /* ignore */ }
    }
    updateConnectionUI();
    closeModal(settingsModal);
    showToast(`Connected to ${repository.full_name || repoLabel(config.repo)}.`, 'success');
  } catch (error) {
    settingsError.textContent = readableError(error, error.response);
    settingsError.classList.remove('hidden');
  } finally {
    setBusy($('#save-settings'), false, '.save-label', 'Save & test connection');
  }
}

function chooseImage() { cameraInput.click(); }

function clearPreview() {
  selectedFile = null;
  selectedDataUrl = '';
  if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = ''; }
  photoPreview.removeAttribute('src');
  emptyCapture.classList.remove('hidden');
  photoCapture.classList.add('hidden');
  captureState.textContent = 'awaiting capture';
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { const dimensions = { width: image.naturalWidth, height: image.naturalHeight }; URL.revokeObjectURL(url); resolve(dimensions); };
    image.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }); };
    image.src = url;
  });
}

function updatePreviewMeta(dimensions) {
  previewResolution.textContent = dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : 'image preview';
  selectedFileName.textContent = selectedFile.name;
  selectedFileSize.textContent = formatBytes(selectedFile.size);
  const fileIcon = document.querySelector('.file-icon');
  fileIcon.textContent = selectedFile.type.split('/')[1]?.slice(0, 4).toUpperCase() || 'IMG';
}

async function handlePhoto(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('Please choose an image file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    showToast('That image is over 10 MB. Choose a smaller photo or compress it first.', 'error');
    return;
  }
  clearPreview();
  selectedFile = file;
  previewObjectUrl = URL.createObjectURL(file);
  photoPreview.src = previewObjectUrl;
  emptyCapture.classList.add('hidden');
  photoCapture.classList.remove('hidden');
  captureState.textContent = 'ready to review';
  const dimensions = await readImageDimensions(file);
  updatePreviewMeta(dimensions);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function prepareUpload(file) {
  // Keep normal phone photos byte-for-byte intact. Larger images are resized and encoded
  // in-browser to stay comfortably below the GitHub Contents API payload ceiling.
  if (file.size <= 7.5 * 1024 * 1024 && file.type !== 'image/heic' && file.type !== 'image/heif') {
    const dataUrl = await fileToDataUrl(file);
    return { base64: dataUrl.split(',')[1], mime: file.type || 'image/jpeg', name: slugifyFileName(file.type), bytes: file.size };
  }
  const dimensions = await readImageDimensions(file);
  if (!dimensions.width || !dimensions.height) throw new Error('This image could not be decoded by the browser.');
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.src = objectUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(objectUrl);
  const blob = await canvasToBlob(canvas, 'image/jpeg', .88);
  if (!blob) throw new Error('The browser could not prepare this image.');
  if (blob.size > MAX_BYTES) throw new Error('This image is still over 10 MB after local compression.');
  const dataUrl = await fileToDataUrl(blob);
  return { base64: dataUrl.split(',')[1], mime: 'image/jpeg', name: slugifyFileName('image/jpeg'), bytes: blob.size };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The browser could not read this image.'));
    reader.readAsDataURL(file);
  });
}

function buildTargetPath(fileName, config) {
  const folder = normaliseFolder(config.folder);
  return folder ? `${folder}/${fileName}` : fileName;
}

async function findExistingSha(parts, path, branch) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${API_ROOT}/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  try {
    const { data } = await githubRequest(url, { method: 'GET' });
    return data?.sha || null;
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
}

async function publishPhoto() {
  const config = currentConfig();
  if (!selectedFile) { showToast('Capture an image before sending it.', 'error'); return; }
  if (!config || !repoParts(config.repo) || !config.token) { openSettings(); showToast('Connect a GitHub repository before publishing.', 'info'); return; }
  const parts = repoParts(config.repo);
  setBusy(publishButton, true, '.publish-button-label', 'Preparing…');
  captureState.textContent = 'preparing local image';
  try {
    const prepared = await prepareUpload(selectedFile);
    const path = buildTargetPath(prepared.name, config);
    const sha = await findExistingSha(parts, path, config.branch || 'main');
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${API_ROOT}/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/contents/${encodedPath}`;
    const body = {
      message: `Upload camera photo ${prepared.name}`,
      content: prepared.base64,
      branch: config.branch || 'main',
      ...(sha ? { sha } : {})
    };
    setBusy(publishButton, true, '.publish-button-label', 'Sending…');
    captureState.textContent = 'sending to GitHub';
    const { data } = await githubRequest(url, { method: 'PUT', body: JSON.stringify(body) });
    const activity = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: prepared.name,
      path,
      repo: repoLabel(config.repo),
      time: new Date().toISOString(),
      url: data?.content?.html_url || `https://github.com/${parts.join('/')}/blob/${encodeURIComponent(config.branch || 'main')}/${encodedPath}`
    };
    const items = [activity, ...getActivity().filter((item) => item.path !== path)];
    setActivity(items);
    renderActivity();
    captureState.textContent = 'published successfully';
    showToast(`Published ${path} to GitHub.`, 'success', 6000);
  } catch (error) {
    captureState.textContent = 'upload failed';
    showToast(readableError(error, error.response), 'error', 6500);
  } finally {
    setBusy(publishButton, false, '.publish-button-label', 'Send to GitHub');
  }
}

function renderActivity() {
  const list = $('#activity-list');
  const items = getActivity();
  const empty = $('#activity-empty');
  list.querySelectorAll('.activity-item').forEach((item) => item.remove());
  if (!items.length) {
    empty.classList.remove('hidden');
    $('#clear-activity').classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  $('#clear-activity').classList.remove('hidden');
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'activity-item';
    row.innerHTML = `<div class="activity-icon"><svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.2 4.2L19.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="activity-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.repo)} / ${escapeHtml(item.path)}</span></div><span class="activity-time">${escapeHtml(formatDate(new Date(item.time)))}</span><a class="activity-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">view ↗</a>`;
    list.appendChild(row);
  });
}

function clearActivity() {
  try { localStorage.removeItem(ACTIVITY_KEY); } catch (error) { /* ignore */ }
  renderActivity();
  showToast('Activity history cleared.', 'info', 2500);
}

function wireEvents() {
  $('#open-camera').addEventListener('click', chooseImage);
  $('#choose-file').addEventListener('click', chooseImage);
  $('#stage-cta').addEventListener('click', chooseImage);
  $('#retake-photo').addEventListener('click', chooseImage);
  $('#remove-photo').addEventListener('click', clearPreview);
  $('#publish-photo').addEventListener('click', publishPhoto);
  $('#open-settings').addEventListener('click', openSettings);
  $('#connect-button').addEventListener('click', () => currentConfig() ? testSavedConnection() : openSettings());
  $('#connection-chip').addEventListener('click', openSettings);
  $('#help-button').addEventListener('click', () => openModal(helpModal));
  $('#close-help').addEventListener('click', () => closeModal(helpModal));
  $('#close-settings').addEventListener('click', () => closeModal(settingsModal));
  $('#cancel-settings').addEventListener('click', () => closeModal(settingsModal));
  $('#clear-activity').addEventListener('click', clearActivity);
  settingsForm.addEventListener('submit', handleSettingsSubmit);
  $('#toggle-token').addEventListener('click', () => {
    const input = $('#token-input');
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    $('#toggle-token').textContent = visible ? 'Show' : 'Hide';
  });
  cameraInput.addEventListener('change', (event) => { const [file] = event.target.files || []; if (file) handlePhoto(file); event.target.value = ''; });
  ['dragenter', 'dragover'].forEach((eventName) => captureStage.addEventListener(eventName, (event) => { event.preventDefault(); captureStage.classList.add('drag-active'); }));
  ['dragleave', 'drop'].forEach((eventName) => captureStage.addEventListener(eventName, (event) => { event.preventDefault(); captureStage.classList.remove('drag-active'); }));
  captureStage.addEventListener('drop', (event) => { const [file] = event.dataTransfer.files || []; if (file) handlePhoto(file); });
  [settingsModal, helpModal].forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal(settingsModal); closeModal(helpModal); } });
}

async function testSavedConnection() {
  const config = currentConfig();
  if (!config) return openSettings();
  const button = $('#connect-button');
  const label = button.querySelector('.connect-button-label');
  const original = label.textContent;
  button.disabled = true;
  label.textContent = 'Testing…';
  try {
    const repository = await testConnection(config);
    showToast(`${repository.full_name || repoLabel(config.repo)} is ready to receive images.`, 'success');
    $('#repo-state').textContent = 'online';
  } catch (error) {
    showToast(readableError(error, error.response), 'error', 6000);
    openSettings();
  } finally {
    button.disabled = false;
    label.textContent = original;
  }
}

function init() {
  savedConfig = EMBEDDED_CONFIG || getStoredConfig();
  updateConnectionUI();
  renderActivity();
  wireEvents();
}

init();
