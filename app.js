const FUNCTION_ROOT = '/.netlify/functions';
const CONFIG_KEY = 'snapline_config_v2';
const ACTIVITY_KEY = 'snapline_activity_v2';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_FUNCTION_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_BATCH_BYTES = 3.5 * 1024 * 1024;
const MAX_BATCH_FILES = 12;

const EMBEDDED_CONFIG = (() => {
  const value = window.SNAPLINE_CONFIG;
  if (!value?.owner || !value?.repo) return null;
  return {
    repo: `${value.owner}/${value.repo}`,
    branch: value.branch || 'main',
    folder: value.folder || ''
  };
})();

const $ = (selector) => document.querySelector(selector);
const cameraInput = $('#camera-input');
const galleryInput = $('#gallery-input');
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

let selectedFiles = [];
let savedConfig = null;
let transientConfig = null;
let previewObjectUrls = [];
let selectionMode = 'camera';
let galleryAppendMode = false;

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
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, 12)));
  } catch (error) {
    // Private browsing can block storage; the upload still works.
  }
}

function currentConfig() {
  return transientConfig || savedConfig || EMBEDDED_CONFIG;
}

function normaliseFolder(folder) {
  return String(folder || '').trim().replace(/^\/+|\/+$/g, '');
}

function repoParts(repo) {
  const clean = String(repo || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
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
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function timestampFileName(mime = '') {
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
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function openModal(modal) {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const focusable = modal.querySelector('input, button');
  window.setTimeout(() => focusable?.focus(), 25);
}

function closeModal(modal) {
  modal.classList.add('hidden');
  if (settingsModal.classList.contains('hidden') && helpModal.classList.contains('hidden')) {
    document.body.style.overflow = '';
  }
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
    repoName.textContent = 'Deployment not configured';
    repoPath.textContent = 'Set Netlify environment variables';
    repoState.textContent = 'offline';
    repoState.classList.remove('online');
    branchValue.textContent = 'main';
    folderValue.textContent = '/';
    connectButtonLabel.textContent = 'Test connection';
  }
}

function populateSettings() {
  const config = currentConfig() || {};
  $('#repo-input').value = config.repo || '';
  $('#branch-input').value = config.branch || 'main';
  $('#folder-input').value = config.folder ?? '';
  $('#remember-input').checked = Boolean(savedConfig || !transientConfig);
  settingsError.classList.add('hidden');
  settingsError.textContent = '';
}

function openSettings() {
  populateSettings();
  openModal(settingsModal);
}

function readableError(error, response) {
  if (error?.message && !/^\d+ /.test(error.message)) return error.message;
  if (!response) return 'The upload service could not be reached. Check the site connection and try again.';
  if (response.status === 401) return 'The private GitHub deployment credential was rejected. Check GITHUB_TOKEN in Netlify.';
  if (response.status === 403) return 'GitHub denied the deployment request. Check Contents: Read and write permission.';
  if (response.status === 404) return 'The configured GitHub repository was not found. Check Netlify repository settings.';
  if (response.status === 409) return 'GitHub found a branch conflict. Check that the main branch exists.';
  if (response.status === 413) return 'This image is too large for the upload service. Try a smaller photo.';
  return `Upload service error ${response.status}. Try again in a moment.`;
}

async function functionRequest(name, options = {}) {
  const response = await fetch(`${FUNCTION_ROOT}/${name}`, options);
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // Keep a useful fallback for empty/non-JSON responses.
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed with ${response.status}`);
    error.response = response;
    error.data = data;
    throw error;
  }
  return { response, data };
}

async function testConnection() {
  const { data } = await functionRequest('status', { method: 'GET' });
  if (!data?.repository) throw new Error('The upload service is missing its GitHub repository configuration.');
  return data;
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  settingsError.classList.add('hidden');
  const config = {
    repo: $('#repo-input').value.trim(),
    branch: $('#branch-input').value.trim() || 'main',
    folder: $('#folder-input').value.trim()
  };
  if (!repoParts(config.repo)) {
    settingsError.textContent = 'Use the repository format owner/name, for example stakewindows63/file.';
    settingsError.classList.remove('hidden');
    return;
  }

  setBusy($('#save-settings'), true, '.save-label', 'Checking deployment…');
  try {
    transientConfig = config;
    const deployment = await testConnection();
    if (deployment.repository.toLowerCase() !== config.repo.toLowerCase()) {
      throw new Error(`This site is configured for ${deployment.repository}, not ${config.repo}.`);
    }
    if ($('#remember-input').checked) {
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (error) { /* ignore */ }
      savedConfig = config;
      transientConfig = null;
    } else {
      savedConfig = null;
      try { localStorage.removeItem(CONFIG_KEY); } catch (error) { /* ignore */ }
    }
    updateConnectionUI();
    closeModal(settingsModal);
    showToast(`Connected to ${deployment.repository}.`, 'success');
  } catch (error) {
    settingsError.textContent = readableError(error, error.response);
    settingsError.classList.remove('hidden');
  } finally {
    setBusy($('#save-settings'), false, '.save-label', 'Check deployment');
  }
}

function chooseImage() {
  cameraInput.click();
}

function chooseGallery(append = false) {
  galleryAppendMode = append;
  galleryInput.click();
}

function clearPreview() {
  selectedFiles = [];
  previewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  previewObjectUrls = [];
  photoPreview.removeAttribute('src');
  photoPreview.classList.remove('hidden');
  $('#batch-file-list').innerHTML = '';
  $('#batch-preview-panel').classList.add('hidden');
  selectionMode = 'camera';
  galleryAppendMode = false;
  emptyCapture.classList.remove('hidden');
  photoCapture.classList.add('hidden');
  captureState.textContent = 'awaiting capture';
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    image.src = url;
  });
}

function updatePreviewMeta(dimensions) {
  const count = selectedFiles.length;
  const galleryMode = selectionMode === 'gallery';
  const countLabel = `${count} file${count === 1 ? '' : 's'} selected`;
  previewResolution.textContent = galleryMode
    ? countLabel
    : dimensions.width && dimensions.height
      ? `${dimensions.width} × ${dimensions.height}`
      : 'image preview';
  selectedFileName.textContent = galleryMode ? countLabel : selectedFiles[0].name;
  selectedFileSize.textContent = formatBytes(selectedFiles.reduce((total, file) => total + file.size, 0));
  const fileIcon = document.querySelector('.file-icon');
  fileIcon.textContent = galleryMode ? 'FILES' : selectedFiles[0].type.split('/')[1]?.slice(0, 4).toUpperCase() || 'IMG';
}

function renderBatchFileList() {
  const list = $('#batch-file-list');
  list.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'batch-file-row';
    const type = file.type.split('/')[1]?.slice(0, 4).toUpperCase() || 'IMG';
    row.innerHTML = `<button class="batch-remove" type="button" aria-label="Remove ${escapeHtml(file.name)}" title="Remove file">×</button><span class="batch-file-type">${escapeHtml(type)}</span><span class="batch-file-copy"><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(formatBytes(file.size))}</small></span>`;
    row.querySelector('.batch-remove').addEventListener('click', () => removeSelectedFile(index));
    list.appendChild(row);
  });
  updatePreviewMeta({ width: 0, height: 0 });
}

function removeSelectedFile(index) {
  selectedFiles = selectedFiles.filter((file, fileIndex) => fileIndex !== index);
  if (!selectedFiles.length) {
    clearPreview();
    return;
  }
  if (selectionMode === 'gallery') {
    renderBatchFileList();
    captureState.textContent = `${selectedFiles.length} files ready to review`;
  }
}

async function handleFiles(fileList, mode = 'gallery') {
  const files = Array.from(fileList || []).filter((file) => file?.type?.startsWith('image/'));
  if (!files.length) {
    showToast('Please choose one or more image files.', 'error');
    return;
  }
  const combinedFiles = mode === 'gallery' && galleryAppendMode ? [...selectedFiles, ...files] : files;
  galleryAppendMode = false;
  if (combinedFiles.length > MAX_BATCH_FILES) {
    showToast(`Choose up to ${MAX_BATCH_FILES} photos at a time.`, 'error');
    return;
  }
  const oversized = combinedFiles.find((file) => file.size > MAX_SOURCE_BYTES);
  if (oversized) {
    showToast('One of the selected images is over 20 MB. Choose smaller photos.', 'error');
    return;
  }

  clearPreview();
  selectedFiles = combinedFiles;
  selectionMode = mode;
  emptyCapture.classList.add('hidden');
  photoCapture.classList.remove('hidden');
  captureState.textContent = mode === 'gallery'
    ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready to review`
    : 'ready to review';

  if (mode === 'gallery') {
    photoPreview.removeAttribute('src');
    photoPreview.classList.add('hidden');
    $('#batch-preview-panel').classList.remove('hidden');
    renderBatchFileList();
    return;
  }

  previewObjectUrls = [URL.createObjectURL(selectedFiles[0])];
  photoPreview.src = previewObjectUrls[0];
  const dimensions = await readImageDimensions(selectedFiles[0]);
  updatePreviewMeta(dimensions);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadImage(file) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.src = objectUrl;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  URL.revokeObjectURL(objectUrl);
  return image;
}

async function prepareUpload(file) {
  const canKeepOriginal = file.size <= 2.75 * 1024 * 1024 && file.type !== 'image/heic' && file.type !== 'image/heif';
  if (canKeepOriginal) {
    const dataUrl = await fileToDataUrl(file);
    return {
      base64: dataUrl.split(',')[1],
      mime: file.type || 'image/jpeg',
      name: timestampFileName(file.type),
      bytes: file.size
    };
  }

  const dimensions = await readImageDimensions(file);
  if (!dimensions.width || !dimensions.height) {
    throw new Error('This image could not be decoded by the browser. Try a JPG or PNG.');
  }
  const image = await loadImage(file);
  const attempts = [
    { max: 2200, quality: 0.84 },
    { max: 1900, quality: 0.76 },
    { max: 1500, quality: 0.68 }
  ];

  for (const attempt of attempts) {
    const scale = Math.min(1, attempt.max / Math.max(dimensions.width, dimensions.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(dimensions.width * scale));
    canvas.height = Math.max(1, Math.round(dimensions.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', attempt.quality);
    if (!blob) continue;
    if (blob.size <= MAX_FUNCTION_IMAGE_BYTES) {
      const dataUrl = await fileToDataUrl(blob);
      return {
        base64: dataUrl.split(',')[1],
        mime: 'image/jpeg',
        name: timestampFileName('image/jpeg'),
        bytes: blob.size
      };
    }
  }

  throw new Error('This image is still too large after local compression. Try a smaller photo.');
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
  const folder = normaliseFolder(config?.folder);
  return folder ? `${folder}/${fileName}` : fileName;
}

function makeBatches(files) {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  files.forEach((file) => {
    const wouldExceed = current.length && currentBytes + file.bytes > MAX_BATCH_BYTES;
    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.bytes;
  });
  if (current.length) batches.push(current);
  return batches;
}

function activityFromUpload(item, config) {
  const path = item.path || buildTargetPath(item.name, config);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: item.name,
    path,
    repo: repoLabel(config.repo),
    time: new Date().toISOString(),
    url: item.url || `https://github.com/${config.repo}/blob/${encodeURIComponent(config.branch || 'main')}/${encodedPath}`
  };
}

async function publishPhoto() {
  const config = currentConfig();
  if (!selectedFiles.length) {
    showToast('Capture or choose at least one image before sending it.', 'error');
    return;
  }
  if (!config || !repoParts(config.repo)) {
    openSettings();
    showToast('This deployment is not configured yet.', 'info');
    return;
  }

  setBusy(publishButton, true, '.publish-button-label', 'Preparing…');
  captureState.textContent = `preparing ${selectedFiles.length} photo${selectedFiles.length === 1 ? '' : 's'}`;
  try {
    const preparedFiles = [];
    for (let index = 0; index < selectedFiles.length; index += 1) {
      setBusy(publishButton, true, '.publish-button-label', `Preparing ${index + 1}/${selectedFiles.length}…`);
      preparedFiles.push(await prepareUpload(selectedFiles[index]));
    }

    const batches = makeBatches(preparedFiles);
    const uploadedActivities = [];
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      setBusy(publishButton, true, '.publish-button-label', `Sending ${index + 1}/${batches.length}…`);
      captureState.textContent = `sending ${uploadedActivities.length}/${preparedFiles.length} photos`;
      const { data } = await functionRequest('batch-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: batch.map((file) => ({ filename: file.name, content: file.base64, mime: file.mime }))
        })
      });
      (data?.files || []).forEach((item) => uploadedActivities.push(activityFromUpload(item, config)));
      const items = [...uploadedActivities, ...getActivity().filter((item) => !uploadedActivities.some((uploaded) => uploaded.path === item.path))];
      setActivity(items);
      renderActivity();
    }

    captureState.textContent = `published ${uploadedActivities.length} photo${uploadedActivities.length === 1 ? '' : 's'}`;
    showToast(`Published ${uploadedActivities.length} photo${uploadedActivities.length === 1 ? '' : 's'} to GitHub.`, 'success', 6500);
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
  $('#gallery-button').addEventListener('click', () => chooseGallery(false));
  $('#batch-add-more').addEventListener('click', () => chooseGallery(true));
  $('#retake-photo').addEventListener('click', chooseImage);
  $('#remove-photo').addEventListener('click', clearPreview);
  $('#publish-photo').addEventListener('click', publishPhoto);
  $('#open-settings').addEventListener('click', openSettings);
  $('#connect-button').addEventListener('click', () => testSavedConnection());
  $('#connection-chip').addEventListener('click', openSettings);
  $('#help-button').addEventListener('click', () => openModal(helpModal));
  $('#close-help').addEventListener('click', () => closeModal(helpModal));
  $('#close-settings').addEventListener('click', () => closeModal(settingsModal));
  $('#cancel-settings').addEventListener('click', () => closeModal(settingsModal));
  $('#clear-activity').addEventListener('click', clearActivity);
  settingsForm.addEventListener('submit', handleSettingsSubmit);
  cameraInput.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (file) handleFiles([file], 'camera');
    event.target.value = '';
  });
  galleryInput.addEventListener('change', (event) => {
    if (event.target.files?.length) handleFiles(event.target.files, 'gallery');
    event.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((eventName) => captureStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    captureStage.classList.add('drag-active');
  }));
  ['dragleave', 'drop'].forEach((eventName) => captureStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    captureStage.classList.remove('drag-active');
  }));
  captureStage.addEventListener('drop', (event) => {
    if (event.dataTransfer.files?.length) handleFiles(event.dataTransfer.files, 'gallery');
  });
  [settingsModal, helpModal].forEach((modal) => modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal(settingsModal);
      closeModal(helpModal);
    }
  });
}

async function testSavedConnection() {
  const button = $('#connect-button');
  const label = button.querySelector('.connect-button-label');
  const original = label.textContent;
  button.disabled = true;
  label.textContent = 'Testing…';
  try {
    const deployment = await testConnection();
    showToast(`${deployment.repository} is ready to receive images.`, 'success');
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
  // Deployment config contains only public routing information; no GitHub secret.
  savedConfig = EMBEDDED_CONFIG || getStoredConfig();
  updateConnectionUI();
  renderActivity();
  wireEvents();
}

init();
