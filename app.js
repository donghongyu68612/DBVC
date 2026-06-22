const $ = selector => document.querySelector(selector);

const recordBtn = $('#recordBtn');
const stopBtn = $('#stopBtn');
const timer = $('#recordTimer');
const preview = $('#samplePreview');
const fileInput = $('#sampleFile');
const sampleName = $('#sampleName');
const sampleSaveName = $('#sampleSaveName');
const saveSampleBtn = $('#saveSampleBtn');
const savedSampleSelect = $('#savedSampleSelect');
const useSavedSampleBtn = $('#useSavedSampleBtn');
const renameSampleBtn = $('#renameSampleBtn');
const deleteSampleBtn = $('#deleteSampleBtn');
const sampleLibrary = $('#sampleLibrary');
const generationHistory = $('#generationHistory');
const form = $('#voiceForm');
const result = $('#result');
const apiStatus = $('#apiStatus');
const modelSelect = $('#modelSelect');
const modelStatusHint = $('#modelStatusHint');
const compareModelsBtn = $('#compareModelsBtn');

let mediaRecorder;
let chunks = [];
let recordedBlob;
let currentSampleFile;
let selectedSavedSampleId = '';
let samples = [];
let generations = [];
let startedAt;
let tickId;

function formatTime(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function showResult(message, isError = false, extraNode) {
  result.hidden = false;
  result.className = `result${isError ? ' error' : ''}`;
  result.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = message;
  result.append(p);
  if (extraNode) result.append(extraNode);
}

function actualExt(type = '') {
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4') || type.includes('aac')) return 'm4a';
  return 'webm';
}

function setPreview(blob, name) {
  currentSampleFile = blob;
  recordedBlob = blob instanceof File ? null : blob;
  preview.src = URL.createObjectURL(blob);
  preview.hidden = false;
  sampleName.textContent = name;
  selectedSavedSampleId = '';
  savedSampleSelect.value = '';
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || '请求失败');
  return data;
}

async function refreshStatus() {
  try {
    const data = await apiJson('/api/local-tts/status');
    const modelNotes = (data.models || []).map(m => `${m.order}. ${m.name}: ${m.configured ? '可用' : '未配置'}${m.note ? ' - ' + m.note : ''}`);
    if (modelStatusHint) modelStatusHint.textContent = modelNotes.join(' ｜ ');
    if (data.models?.some(m => m.configured)) {
      apiStatus.textContent = '本地TTS模型检测完成';
      apiStatus.classList.add('ok');
    } else {
      apiStatus.textContent = '本地TTS模型未配置，请检查 config.local.json';
      apiStatus.classList.remove('ok');
    }
  } catch {
    apiStatus.textContent = '请通过 Node 后端打开页面';
    apiStatus.classList.remove('ok');
  }
}

async function loadSamples() {
  try {
    const data = await apiJson('/api/samples');
    samples = data.samples || [];
    renderSamples();
  } catch (error) {
    sampleLibrary.innerHTML = `<p class="hint">样本库加载失败：${error.message}</p>`;
  }
}

async function loadGenerations() {
  try {
    const data = await apiJson('/api/generations');
    generations = data.generations || [];
    renderGenerations();
  } catch (error) {
    generationHistory.innerHTML = `<p class="hint">生成历史加载失败：${error.message}</p>`;
  }
}

function renderSamples() {
  savedSampleSelect.innerHTML = '<option value="">不使用已保存样本，使用下面的新录音/上传</option>';
  for (const sample of samples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = `${sample.name}（${new Date(sample.updatedAt || sample.createdAt).toLocaleString()}）`;
    savedSampleSelect.append(option);
  }
  savedSampleSelect.value = selectedSavedSampleId;

  if (!samples.length) {
    sampleLibrary.innerHTML = '<p class="hint">还没有保存的声音样本。录音或上传后，填写名称并点击“保存声音样本”。</p>';
    return;
  }

  sampleLibrary.innerHTML = '';
  for (const sample of samples) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-main">
        <strong>${escapeHtml(sample.name)}</strong>
        <span>${new Date(sample.updatedAt || sample.createdAt).toLocaleString()} · ${Math.round((sample.originalSize || 0) / 1024)} KB</span>
        <audio controls src="${sample.mp3Url}"></audio>
      </div>
      <div class="list-actions">
        <button class="btn" type="button" data-use="${sample.id}">使用</button>
        <a class="btn" href="${sample.mp3Url}" download>下载MP3</a>
      </div>
    `;
    sampleLibrary.append(item);
  }

  sampleLibrary.querySelectorAll('[data-use]').forEach(btn => {
    btn.addEventListener('click', () => useSavedSample(btn.dataset.use));
  });
}



function renderComparisonResults(items) {
  const box = document.createElement('div');
  box.className = 'list';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <div class="list-main">
        <strong>${escapeHtml(item.modelName || item.model)}</strong>
        <span>${escapeHtml(item.message || '')}</span>
        <audio controls src="${item.audioMp3Url || item.audioUrl}"></audio>
      </div>
      <div class="list-actions">
        <a class="btn primary" href="${item.audioMp3Url || item.audioUrl}" download>下载MP3</a>
        <a class="btn" href="${item.audioWavUrl || '#'}" download>下载WAV</a>
      </div>
    `;
    box.append(row);
  }
  return box;
}

function renderGenerations() {
  if (!generations.length) {
    generationHistory.innerHTML = '<p class="hint">还没有生成记录。</p>';
    return;
  }
  generationHistory.innerHTML = '';
  for (const gen of generations) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-main">
        <strong> ·  · ${new Date(gen.createdAt).toLocaleString()}</strong>
        <span>${escapeHtml((gen.text || '').slice(0, 120))}${(gen.text || '').length > 120 ? '...' : ''}</span>
        <audio controls src="${gen.audioMp3Url || gen.audioUrl}"></audio>
      </div>
      <div class="list-actions">
        <a class="btn primary" href="${gen.audioMp3Url || gen.audioUrl}" download>下载MP3</a>
        <a class="btn" href="${gen.audioWavUrl}" download>下载WAV</a>
      </div>
    `;
    generationHistory.append(item);
  }
}

function useSavedSample(id) {
  const sample = samples.find(s => s.id === id);
  if (!sample) return;
  selectedSavedSampleId = id;
  savedSampleSelect.value = id;
  currentSampleFile = null;
  recordedBlob = null;
  fileInput.value = '';
  preview.src = sample.mp3Url;
  preview.hidden = false;
  sampleName.textContent = `当前使用已保存样本：${sample.name}`;
  showResult(`已选择声音样本：${sample.name}`);
}

recordBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const preferredTypes = ['audio/mpeg', 'audio/mp3', 'audio/webm;codecs=opus', 'audio/webm'];
    const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    mediaRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach(track => track.stop());
      const type = mediaRecorder.mimeType || 'audio/webm';
      const ext = actualExt(type);
      const blob = new Blob(chunks, { type });
      blob.name = `recording.${ext}`;
      setPreview(blob, `新录音样本（${ext}，保存后会生成 MP3/WAV）`);
      clearInterval(tickId);
    });
    mediaRecorder.start();
    startedAt = Date.now();
    tickId = setInterval(() => { timer.textContent = formatTime(Math.floor((Date.now() - startedAt) / 1000)); }, 250);
    recordBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    showResult(`无法开始录音：${error.message}`, true);
  }
});

stopBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  recordBtn.disabled = false;
  stopBtn.disabled = true;
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setPreview(file, `已选择新样本：${file.name}`);
  if (!sampleSaveName.value.trim()) sampleSaveName.value = file.name.replace(/\.[^.]+$/, '');
});

saveSampleBtn.addEventListener('click', async () => {
  const consent = $('#consent').checked;
  if (!consent) return showResult('请先勾选授权确认，再保存声音样本。', true);
  if (!currentSampleFile) return showResult('请先录制或上传一个声音样本。', true);
  const name = sampleSaveName.value.trim() || `声音样本 ${new Date().toLocaleString()}`;
  const formData = new FormData();
  const uploadName = currentSampleFile.name || (currentSampleFile.type?.includes('mp3') || currentSampleFile.type?.includes('mpeg') ? 'recording.mp3' : 'recording.webm');
  formData.append('name', name);
  formData.append('consentConfirmed', 'true');
  formData.append('sample', currentSampleFile, uploadName);
  showResult('正在保存声音样本并转成 MP3/WAV...');
  try {
    const data = await apiJson('/api/samples', { method: 'POST', body: formData });
    await loadSamples();
    useSavedSample(data.sample.id);
    showResult(`声音样本已保存：${data.sample.name}`);
  } catch (error) {
    showResult(`保存失败：${error.message}`, true);
  }
});

savedSampleSelect.addEventListener('change', () => {
  if (savedSampleSelect.value) useSavedSample(savedSampleSelect.value);
  else selectedSavedSampleId = '';
});
useSavedSampleBtn.addEventListener('click', () => {
  if (!savedSampleSelect.value) return showResult('请先选择一个已保存样本。', true);
  useSavedSample(savedSampleSelect.value);
});

renameSampleBtn.addEventListener('click', async () => {
  const id = savedSampleSelect.value || selectedSavedSampleId;
  if (!id) return showResult('请先选择一个已保存样本。', true);
  const sample = samples.find(s => s.id === id);
  const name = prompt('请输入新的样本名称：', sample?.name || '');
  if (!name) return;
  try {
    await apiJson('/api/samples/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
    selectedSavedSampleId = id;
    await loadSamples();
    useSavedSample(id);
    showResult('样本已改名。');
  } catch (error) {
    showResult(`改名失败：${error.message}`, true);
  }
});

deleteSampleBtn.addEventListener('click', async () => {
  const id = savedSampleSelect.value || selectedSavedSampleId;
  if (!id) return showResult('请先选择一个已保存样本。', true);
  const sample = samples.find(s => s.id === id);
  if (!confirm(`确定删除声音样本“${sample?.name || id}”吗？`)) return;
  try {
    await apiJson(`/api/samples/${encodeURIComponent(id)}`, { method: 'DELETE' });
    selectedSavedSampleId = '';
    await loadSamples();
    preview.hidden = true;
    sampleName.textContent = '尚未选择声音样本';
    showResult('样本已删除。');
  } catch (error) {
    showResult(`删除失败：${error.message}`, true);
  }
});

form.addEventListener('reset', () => {
  setTimeout(() => {
    preview.hidden = true;
    preview.removeAttribute('src');
    recordedBlob = undefined;
    currentSampleFile = undefined;
    selectedSavedSampleId = '';
    savedSampleSelect.value = '';
    sampleName.textContent = '尚未选择声音样本';
    result.hidden = true;
    timer.textContent = '00:00';
  });
});



compareModelsBtn.addEventListener('click', async () => {
  const text = $('#scriptText').value.trim();
  const consent = $('#consent').checked;
  if (!consent) return showResult('请先确认你拥有该声音的授权。', true);
  if (!text) return showResult('请输入要生成的朗读文本。', true);
  if (!selectedSavedSampleId && !currentSampleFile) return showResult('请选择已保存样本，或录制/上传一个新样本。', true);

  const formData = new FormData();
  formData.append('text', text);
  formData.append('promptText', $('#promptText').value.trim());
  formData.append('style', $('#style').value);
  formData.append('speed', $('#speed').value);
  formData.append('consentConfirmed', 'true');
  if (selectedSavedSampleId) {
    formData.append('sampleId', selectedSavedSampleId);
  } else {
    const uploadName = currentSampleFile.name || (currentSampleFile.type?.includes('mp3') || currentSampleFile.type?.includes('mpeg') ? 'recording.mp3' : 'recording.webm');
    formData.append('sample', currentSampleFile, uploadName);
  }
  showResult('正在依次生成 GPT-SoVITS、CosyVoice2、Index-TTS，请稍等……');
  try {
    const res = await fetch('/api/compare-models', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || '对比生成失败');
    showResult('三模型对比生成完成。', false, renderComparisonResults(data.results || []));
    await loadGenerations();
  } catch (error) {
    showResult(`对比生成失败：${error.message}`, true);
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('#scriptText').value.trim();
  const consent = $('#consent').checked;
  if (!consent) return showResult('请先确认你拥有该声音的授权。', true);
  if (!text) return showResult('请输入要生成的朗读文本。', true);
  if (!selectedSavedSampleId && !currentSampleFile) return showResult('请选择已保存样本，或录制/上传一个新样本。', true);

  const formData = new FormData();
  formData.append('text', text);
  formData.append('model', $('#modelSelect').value);
  formData.append('promptText', $('#promptText').value.trim());
  formData.append('style', $('#style').value);
  formData.append('speed', $('#speed').value);
  formData.append('consentConfirmed', 'true');
  if (selectedSavedSampleId) {
    formData.append('sampleId', selectedSavedSampleId);
  } else {
    const uploadName = currentSampleFile.name || (currentSampleFile.type?.includes('mp3') || currentSampleFile.type?.includes('mpeg') ? 'recording.mp3' : 'recording.webm');
    formData.append('sample', currentSampleFile, uploadName);
  }

  showResult('正在生成语音并保存到本地历史，请稍等……');
  try {
    const data = await apiJson('/api/voice-clone', { method: 'POST', body: formData });
    const box = document.createElement('div');
    box.innerHTML = `
      <audio controls src="${data.audioMp3Url || data.audioUrl}"></audio>
      <div class="actions compact">
        <a class="btn primary" href="${data.audioMp3Url || data.audioUrl}" download>下载MP3</a>
        <a class="btn" href="${data.audioWavUrl}" download>下载WAV</a>
      </div>
    `;
    showResult('生成成功，已保存到本地生成历史。', false, box);
    await loadGenerations();
  } catch (error) {
    showResult(`生成失败：${error.message}`, true);
  } finally {
    refreshStatus();
  }
});

const startBtn = document.createElement('button');
startBtn.type = 'button';
startBtn.className = 'btn';
startBtn.textContent = '启动原版 Index-TTS WebUI';
startBtn.addEventListener('click', async () => {
  try {
    const data = await apiJson('/api/local-tts/start', { method: 'POST' });
    showResult(data.message || '已尝试启动原版 Index-TTS WebUI。');
  } catch (error) {
    showResult(`启动失败：${error.message}`, true);
  }
});
apiStatus.after(startBtn);

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

refreshStatus();
loadSamples();
loadGenerations();


