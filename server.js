import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(__filename);
const configPath = path.join(projectRoot, 'config.local.json');
const dataDir = path.join(projectRoot, 'data');
const samplesDir = path.join(projectRoot, 'samples');
const generatedDir = path.join(projectRoot, 'generated');
const uploadsDir = path.join(projectRoot, 'uploads');
const dbPath = path.join(dataDir, 'db.json');
const maxUploadBytes = 80 * 1024 * 1024;

for (const dir of [dataDir, samplesDir, generatedDir, uploadsDir]) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(dbPath)) saveDb({ samples: [], generations: [] });

function readConfig() {
  const fallback = {
    indexRoot: 'D:\\Index-TTS-V3\\Index-TTS-V3',
    pythonExe: 'D:\\Index-TTS-V3\\Index-TTS-V3\\deepface\\python.exe',
    ffmpegExe: 'D:\\Index-TTS-V3\\Index-TTS-V3\\deepface\\ffmpeg\\ffmpeg.exe',
    localTtsExe: 'D:\\Index-TTS-V3\\Index-TTS-V3\\一键启动.exe',
    defaultMode: 'normal',
    defaultModel: 'cosyvoice2',
    cosyVoice2: { enabled: false, baseUrl: 'http://127.0.0.1:50000', endpoint: '/inference_zero_shot' }
  };
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch { return fallback; }
}

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return { samples: db.samples || [], generations: db.generations || [] };
  } catch {
    return { samples: [], generations: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/local-tts/status') {
      const config = readConfig();
      const models = await getModelStatus(config);
      return json(res, 200, { ok: true, config: safeConfig(config), status: checkLocalIndexTts(config), models });
    }
    if (req.method === 'POST' && url.pathname === '/api/local-tts/start') return startOriginalWebUI(res);
    if (req.method === 'GET' && url.pathname === '/api/samples') return listSamples(res);
    if (req.method === 'POST' && url.pathname === '/api/samples') return saveSampleEndpoint(req, res);
    if (req.method === 'POST' && url.pathname === '/api/samples/rename') return renameSampleEndpoint(req, res);
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/samples/')) return deleteSampleEndpoint(url, res);
    if (req.method === 'GET' && url.pathname === '/api/generations') return listGenerations(res);
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/generations/')) return deleteGenerationEndpoint(url, res);
    if (req.method === 'POST' && url.pathname === '/api/compare-models') return handleCompareModels(req, res);
    if (req.method === 'POST' && url.pathname === '/api/voice-clone') return handleVoiceClone(req, res);

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error?.message || error) });
  }
});

function withPublicUrls(item) {
  return {
    ...item,
    mp3Url: item.mp3File ? `/samples/${encodeURIComponent(item.mp3File)}` : item.mp3Url,
    wavUrl: item.wavFile ? `/samples/${encodeURIComponent(item.wavFile)}` : item.wavUrl,
  };
}

function generationWithUrls(item) {
  return {
    ...item,
    audioUrl: item.mp3File ? `/generated/${encodeURIComponent(item.mp3File)}` : item.audioUrl,
    audioMp3Url: item.mp3File ? `/generated/${encodeURIComponent(item.mp3File)}` : item.audioMp3Url,
    audioWavUrl: item.wavFile ? `/generated/${encodeURIComponent(item.wavFile)}` : item.audioWavUrl,
  };
}

function listSamples(res) {
  const db = loadDb();
  return json(res, 200, { ok: true, samples: db.samples.map(withPublicUrls).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
}

function listGenerations(res) {
  const db = loadDb();
  return json(res, 200, { ok: true, generations: db.generations.map(generationWithUrls).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

function deleteGenerationEndpoint(url, res) {
  const id = decodeURIComponent(url.pathname.split('/').pop() || '');
  const db = loadDb();
  const idx = db.generations.findIndex(g => g.id === id);
  if (idx === -1) return json(res, 404, { ok: false, error: '找不到生成记录。' });
  const [generation] = db.generations.splice(idx, 1);
  for (const file of [generation.mp3File, generation.wavFile]) {
    if (!file) continue;
    const p = path.join(generatedDir, file);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  saveDb(db);
  return json(res, 200, { ok: true });
}


async function saveSampleEndpoint(req, res) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) return json(res, 400, { ok: false, error: '请求必须是 multipart/form-data。' });
  const body = await readRequestBody(req, maxUploadBytes);
  const form = parseMultipart(body, contentType);
  const sample = form.files.sample;
  const name = sanitizeName(String(form.fields.name || '').trim() || '未命名声音样本');
  const consentConfirmed = String(form.fields.consentConfirmed || 'false');
  if (consentConfirmed !== 'true') return json(res, 400, { ok: false, error: '必须确认声音授权。' });
  if (!sample) return json(res, 400, { ok: false, error: '缺少声音样本。' });

  const config = readConfig();
  const checks = checkLocalIndexTts(config);
  if (!checks.ffmpegExists) return json(res, 503, { ok: false, error: 'ffmpeg 不存在，无法保存声音样本。', checks });

  try {
    const saved = await persistSample({ config, file: sample, name });
    const db = loadDb();
    db.samples.unshift(saved);
    saveDb(db);
    return json(res, 200, { ok: true, sample: withPublicUrls(saved), message: '声音样本已保存，下次可直接选择使用。' });
  } catch (error) {
    return json(res, 500, { ok: false, error: '保存声音样本失败。', detail: String(error?.message || error), log: error?.log || '' });
  }
}

async function renameSampleEndpoint(req, res) {
  const body = await readJsonBody(req);
  const id = String(body.id || '');
  const name = sanitizeName(String(body.name || '').trim());
  if (!id || !name) return json(res, 400, { ok: false, error: '缺少样本 ID 或新名称。' });
  const db = loadDb();
  const sample = db.samples.find(s => s.id === id);
  if (!sample) return json(res, 404, { ok: false, error: '找不到声音样本。' });
  sample.name = name;
  sample.updatedAt = new Date().toISOString();
  saveDb(db);
  return json(res, 200, { ok: true, sample: withPublicUrls(sample) });
}

function deleteSampleEndpoint(url, res) {
  const id = decodeURIComponent(url.pathname.split('/').pop() || '');
  const db = loadDb();
  const idx = db.samples.findIndex(s => s.id === id);
  if (idx === -1) return json(res, 404, { ok: false, error: '找不到声音样本。' });
  const [sample] = db.samples.splice(idx, 1);
  for (const file of [sample.rawFile, sample.mp3File, sample.wavFile]) {
    if (!file) continue;
    const p = path.join(samplesDir, file);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  saveDb(db);
  return json(res, 200, { ok: true });
}

async function persistSample({ config, file, name }) {
  const id = `sample_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const ext = extensionFromMime(file.contentType) || path.extname(file.filename || '') || '.webm';
  const rawFile = `${id}_raw${ext}`;
  const mp3File = `${id}.mp3`;
  const wavFile = `${id}.wav`;
  const rawPath = path.join(samplesDir, rawFile);
  const mp3Path = path.join(samplesDir, mp3File);
  const wavPath = path.join(samplesDir, wavFile);
  fs.writeFileSync(rawPath, file.data);
  await convertAudio(config, rawPath, mp3Path, ['-y', '-i', rawPath, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '192k', mp3Path]);
  await convertAudio(config, rawPath, wavPath, ['-y', '-i', rawPath, '-vn', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', wavPath]);
  const now = new Date().toISOString();
  return {
    id, name, createdAt: now, updatedAt: now,
    originalName: file.filename || 'recording', originalMime: file.contentType, originalSize: file.data.length,
    rawFile, mp3File, wavFile,
    rawPath, mp3Path, wavPath
  };
}



async function parseVoiceCloneRequest(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) throw new Error('请求必须是 multipart/form-data。');
  const body = await readRequestBody(req, maxUploadBytes);
  const form = parseMultipart(body, contentType);
  const text = String(form.fields.text || '').trim();
  const style = String(form.fields.style || 'natural');
  const speed = String(form.fields.speed || '1');
  const model = normalizeModelId(String(form.fields.model || 'index-tts'));
  const promptText = String(form.fields.promptText || '').trim();
  const consentConfirmed = String(form.fields.consentConfirmed || 'false');
  const sampleId = String(form.fields.sampleId || '');
  const sampleFile = form.files.sample;
  return { form, text, style, speed, model, promptText, consentConfirmed, sampleId, sampleFile };
}

async function handleCompareModels(req, res) {
  try {
    const parsed = await parseVoiceCloneRequest(req);
    const models = ['cosyvoice2', 'index-tts'];
    const results = [];
    for (const model of models) {
      const fakeReq = { headers: req.headers };
      fakeReq._parsed = { ...parsed, model };
      const result = await generateVoiceFromParsed(fakeReq, true);
      results.append(result);
    }
    return json(res, 200, { ok: true, results });
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error?.message || error) });
  }
}

async function handleVoiceClone(req, res) {
  try {
    const data = await generateVoiceFromParsed(req, false);
    return json(res, 200, { ok: true, ...data, message: '已生成语音，文件已保存到本地生成历史。' });
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error?.message || error), detail: String(error?.message || error), log: error?.log || '' });
  }
}

async function generateVoiceFromParsed(req, forCompare = false) {
  const parsed = req._parsed || await parseVoiceCloneRequest(req);
  const { text, style, speed, model, promptText, consentConfirmed, sampleId, sampleFile } = parsed;
  const config = readConfig();

  if (consentConfirmed !== 'true') return json(res, 400, { ok: false, error: '必须确认声音授权。' });
  if (!text) return json(res, 400, { ok: false, error: '缺少朗读文本。' });

  const checks = checkLocalIndexTts(config);
  if (!checks.ready) return json(res, 503, { ok: false, error: '本地 Index-TTS 环境不完整。', checks });

  let wavSamplePath;
  let usedSample = null;
  let tempRawPath = null;

  if (sampleId) {
    const db = loadDb();
    usedSample = db.samples.find(s => s.id === sampleId);
    if (!usedSample) return json(res, 404, { ok: false, error: '找不到已保存的声音样本。' });
    wavSamplePath = usedSample.wavPath || path.join(samplesDir, usedSample.wavFile);
    if (!fs.existsSync(wavSamplePath)) return json(res, 404, { ok: false, error: '声音样本 WAV 文件不存在，请重新保存样本。' });
  } else if (sampleFile) {
    const idForTemp = `temp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const ext = extensionFromMime(sampleFile.contentType) || path.extname(sampleFile.filename || '') || '.webm';
    tempRawPath = path.join(uploadsDir, `${idForTemp}_raw${ext}`);
    wavSamplePath = path.join(uploadsDir, `${idForTemp}_sample.wav`);
    fs.writeFileSync(tempRawPath, sampleFile.data);
    try {
      await convertAudio(config, tempRawPath, wavSamplePath, ['-y', '-i', tempRawPath, '-vn', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', wavSamplePath]);
    } catch (error) {
      return json(res, 500, { ok: false, error: '临时参考音频转 WAV 失败。', detail: String(error?.message || error), log: error?.log || '' });
    }
  } else {
    return json(res, 400, { ok: false, error: '请选择已保存声音样本，或录制/上传一个新样本。' });
  }

  const id = `voice_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const wavOutputPath = path.join(generatedDir, `${id}.wav`);
  const mp3OutputPath = path.join(generatedDir, `${id}.mp3`);

  try {
    const result = await runSelectedLocalModel({ config, model, samplePath: wavSamplePath, text, promptText, outputPath: wavOutputPath, style, speed });
    await convertAudio(config, result.output || wavOutputPath, mp3OutputPath, ['-y', '-i', result.output || wavOutputPath, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '192k', mp3OutputPath]);

    const generation = {
      id,
      createdAt: new Date().toISOString(),
      model,
      modelName: modelDisplayName(model),
      text,
      promptText,
      style,
      speed,
      sampleId: usedSample?.id || null,
      sampleName: usedSample?.name || '临时声音样本',
      mp3File: path.basename(mp3OutputPath),
      wavFile: path.basename(result.output || wavOutputPath),
      mp3Path: mp3OutputPath,
      wavPath: result.output || wavOutputPath,
      elapsedSeconds: result.elapsedSeconds
    };
    const db = loadDb();
    db.generations.unshift(generation);
    saveDb(db);

    return { ...generationWithUrls(generation), message: '已生成语音，文件已保存到本地生成历史。' };
  } catch (error) {
    error.message = `${modelDisplayName(model)} 本地生成失败：${String(error?.message || error)}`;
    throw error;
  }
}


function startOriginalWebUI(res) {
  const config = readConfig();
  if (!config.localTtsExe || !fs.existsSync(config.localTtsExe)) return json(res, 404, { ok: false, error: `找不到本地启动程序：${config.localTtsExe}` });
  const child = spawn(config.localTtsExe, [], { cwd: config.indexRoot, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return json(res, 200, { ok: true, message: '已启动原版 Index-TTS WebUI。', config: safeConfig(config) });
}

function checkLocalIndexTts(config) {
  const indexRootExists = !!config.indexRoot && fs.existsSync(config.indexRoot);
  const pythonExists = !!config.pythonExe && fs.existsSync(config.pythonExe);
  const ffmpegExists = !!config.ffmpegExe && fs.existsSync(config.ffmpegExe);
  const checkpoints = ['bigvgan_generator.pth', 'bpe.model', 'gpt.pth', 'config.yaml'];
  const checkpointStatus = Object.fromEntries(checkpoints.map(name => [name, fs.existsSync(path.join(config.indexRoot || '', 'checkpoints', name))]));
  const bridgeExists = fs.existsSync(path.join(projectRoot, 'index_tts_bridge.py'));
  const inferExists = fs.existsSync(path.join(config.indexRoot || '', 'indextts', 'infer.py'));
  return { ready: indexRootExists && pythonExists && ffmpegExists && bridgeExists && inferExists && Object.values(checkpointStatus).every(Boolean), indexRootExists, pythonExists, ffmpegExists, bridgeExists, inferExists, checkpointStatus };
}

function convertAudio(config, inputPath, outputPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegExe, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => { err.log = stderr || stdout; reject(err); });
    child.on('close', code => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        const err = new Error(`ffmpeg exited with code ${code}`);
        err.log = `${stdout}\n${stderr}`.trim();
        reject(err); return;
      }
      resolve(outputPath);
    });
  });
}


function normalizeModelId(model) {
  if (['cosyvoice2', 'index-tts'].includes(model)) return model;
  return 'index-tts';
}

function modelDisplayName(model) {
  return {
    'cosyvoice2': 'CosyVoice2 中文情感模型',
    'index-tts': 'Index-TTS 模型'
  }[model] || model;
}

function isLocalBaseUrl(value) {
  try {
    const u = new URL(value);
    return ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  } catch { return false; }
}



async function probeHttp(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return { online: res.ok, status: res.status };
  } catch (error) {
    return { online: false, error: String(error?.message || error) };
  }
}
async function getModelStatus(config) {
  const cosyConfigured = !!config.cosyVoice2?.enabled && isLocalBaseUrl(config.cosyVoice2?.baseUrl || '');
  const indexConfigured = checkLocalIndexTts(config).ready;
  const cosyProbe = cosyConfigured ? await probeHttp(`${String(config.cosyVoice2.baseUrl).replace(/\/$/, '')}`) : { online: false };
  const indexProbe = { online: indexConfigured }; // Index-TTS works via bridge, not web server
  return [
    { id: 'cosyvoice2', name: modelDisplayName('cosyvoice2'), order: 1, localOnly: true, configured: cosyConfigured, online: !!cosyProbe.online, baseUrl: config.cosyVoice2?.baseUrl || '', note: 'CosyVoice2 中文情感模型' },
    { id: 'index-tts', name: modelDisplayName('index-tts'), order: 2, localOnly: true, configured: indexConfigured, online: !!indexProbe.online, baseUrl: 'http://127.0.0.1:7860', note: '本地 Index-TTS 直连模型（通过 Python bridge 生成）' }
  ];
}

async function runSelectedLocalModel({ config, model, samplePath, text, promptText, outputPath, style, speed }) {
  if (model === 'cosyvoice2') return runCosyVoice2LocalApi({ config, samplePath, text, promptText, outputPath });
  return runIndexTtsBridge({ config, samplePath, text, outputPath, style, speed });
}


function getAudioDurationSeconds(config, audioPath) {
  const ffprobeDir = path.dirname(config.ffmpegExe);
  const ffprobeExe = path.join(ffprobeDir, 'ffprobe.exe');
  const exe = fs.existsSync(ffprobeExe) ? ffprobeExe : config.ffmpegExe;
  const args = fs.existsSync(ffprobeExe)
    ? ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath]
    : ['-i', audioPath];
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => { err.log = stderr; reject(err); });
    child.on('close', code => {
      if (code !== 0) { const err = new Error(`ffprobe exited with code ${code}`); err.log = `${stdout}\n${stderr}`.trim(); reject(err); return; }
      const raw = (stdout || stderr).trim();
      const dur = parseFloat(raw);
      if (isNaN(dur) || dur <= 0) { reject(new Error(`Could not determine audio duration from: ${raw.slice(0, 200)}`)); return; }
      resolve(dur);
    });
  });
}

async function ensureRefAudioDuration(config, samplePath) {
  const dur = await getAudioDurationSeconds(config, samplePath);
  if (dur < 3.0) {
    throw new Error(`参考音频仅 ${dur.toFixed(1)} 秒，模型要求 3~10 秒。请录制/上传一段 3~10 秒的声音样本。`);
  }
  if (dur <= 10.0) return samplePath;
  const start = ((dur - 10) / 2).toFixed(2);
  const trimmedPath = samplePath.replace(/\.wav$/i, '_trimmed.wav').replace(/\.mp3$/i, '_trimmed.wav');
  const args = ['-y', '-ss', start, '-i', samplePath, '-t', '10', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', trimmedPath];
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegExe, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => { err.log = stderr; reject(err); });
    child.on('close', code => {
      if (code !== 0 || !fs.existsSync(trimmedPath)) {
        const err = new Error(`Unable to trim reference audio to 3-10s, ffmpeg exited with code ${code}`);
        err.log = `${stdout}\n${stderr}`.trim();
        reject(err); return;
      }
      resolve(trimmedPath);
    });
  });
}

async function ensureCosyRefAudioDuration(config, samplePath) {
  const dur = await getAudioDurationSeconds(config, samplePath);
  if (dur <= 30.0) return samplePath;
  const start = ((dur - 30) / 2).toFixed(2);
  const trimmedPath = samplePath.replace(/\.wav$/i, '_cosy_trimmed.wav').replace(/\.mp3$/i, '_cosy_trimmed.wav');
  const args = ['-y', '-ss', start, '-i', samplePath, '-t', '30', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', trimmedPath];
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegExe, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => { err.log = stderr; reject(err); });
    child.on('close', code => {
      if (code !== 0 || !fs.existsSync(trimmedPath)) {
        const err = new Error(`Unable to trim reference audio to 30s, ffmpeg exited with code ${code}`);
        err.log = `${stdout}\n${stderr}`.trim();
        reject(err); return;
      }
      resolve(trimmedPath);
    });
  });
}


async function runCosyVoice2LocalApi({ config, samplePath, text, promptText, outputPath }) {
  const modelConfig = config.cosyVoice2 || {};
  if (!modelConfig.enabled) throw new Error('CosyVoice2 未启用。请本地部署 CosyVoice2 API，并在 config.local.json 里把 cosyVoice2.enabled 改为 true。');
  if (!isLocalBaseUrl(modelConfig.baseUrl || '')) throw new Error('CosyVoice2 只允许配置本地地址，例如 http://127.0.0.1:50000。');
  const baseUrl = String(modelConfig.baseUrl).replace(/\/$/, '');
  const usePromptText = !!String(promptText || '').trim();
  const endpoint = `${baseUrl}${usePromptText ? (modelConfig.endpoint || '/inference_zero_shot') : '/inference_cross_lingual'}`;
  const started = Date.now();
  const refPath = await ensureCosyRefAudioDuration(config, samplePath);
  const body = usePromptText
    ? { tts_text: text, prompt_text: promptText, prompt_wav_path: refPath, output_format: 'wav' }
    : { tts_text: text, prompt_wav_path: refPath, output_format: 'wav' };
  console.log('[CosyVoice2] mode=', usePromptText ? 'zero_shot_with_sample_text' : 'audio_only_cross_lingual');
  console.log('[CosyVoice2] tts_text=', text.slice(0, 120));
  console.log('[CosyVoice2] prompt_text=', (promptText || '').slice(0, 120));
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await saveLocalModelAudioResponse(response, outputPath, modelConfig.baseUrl);
  return { ok: true, output: outputPath, elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(3)) };
}

async function saveLocalModelAudioResponse(response, outputPath, baseUrl) {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`本地模型 API HTTP ${response.status}: ${errorText.slice(0, 800)}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    const audioPath = data.audio_path || data.output_path || data.path || data.wav_path;
    const audioUrl = data.audio_url || data.url;
    if (audioPath && fs.existsSync(audioPath)) { fs.copyFileSync(audioPath, outputPath); return; }
    if (audioUrl) {
      const absolute = audioUrl.startsWith('http') ? audioUrl : `${String(baseUrl).replace(/\/$/, '')}/${audioUrl.replace(/^\/+/, '')}`;
      const audioResponse = await fetch(absolute);
      if (!audioResponse.ok) throw new Error(`下载本地模型音频失败 HTTP ${audioResponse.status}`);
      fs.writeFileSync(outputPath, Buffer.from(await audioResponse.arrayBuffer()));
      return;
    }
    throw new Error(`本地模型 API 返回 JSON，但没有 audio_path/audio_url：${JSON.stringify(data).slice(0, 800)}`);
  }
  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

function runIndexTtsBridge({ config, samplePath, text, outputPath, style }) {
  return new Promise((resolve, reject) => {
    const bridgePath = path.join(projectRoot, 'index_tts_bridge.py');
    const mode = style === 'energetic' ? 'fast' : (config.defaultMode || 'normal');
    const args = [bridgePath, '--index-root', config.indexRoot, '--prompt', samplePath, '--text', text, '--out', outputPath, '--mode', mode, '--temperature', style === 'calm' ? '0.8' : style === 'energetic' ? '1.1' : '1.0', '--top-p', '0.8', '--top-k', '30', '--num-beams', '3', '--repetition-penalty', '10.0', '--length-penalty', '0.0', '--max-mel-tokens', '600'];
    const child = spawn(config.pythonExe, args, { cwd: config.indexRoot, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => { err.log = stderr || stdout; reject(err); });
    child.on('close', code => {
      const log = `${stdout}\n${stderr}`.trim();
      const jsonLine = stdout.trim().split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
      let parsed;
      try { parsed = jsonLine ? JSON.parse(jsonLine) : null; } catch {}
      if (code !== 0 || !parsed?.ok) {
        const err = new Error(parsed?.error || `Python bridge exited with code ${code}`);
        err.log = parsed?.traceback || log;
        reject(err); return;
      }
      resolve(parsed);
    });
  });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolved = path.resolve(projectRoot, requested);
  const allowedRoots = [projectRoot, samplesDir, generatedDir];
  if (!allowedRoots.some(root => resolved.startsWith(root))) return text(res, 403, 'Forbidden');
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return text(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': mimeType(resolved), 'Content-Disposition': pathname.includes('/generated/') || pathname.includes('/samples/') ? `inline; filename="${path.basename(resolved)}"` : 'inline' });
  fs.createReadStream(resolved).pipe(res);
}

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', chunk => { total += chunk.length; if (total > limit) { reject(new Error('上传文件太大。')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRequestBody(req, 1024 * 1024);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { return {}; }
}

function parseMultipart(buffer, contentType) {
  const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  if (!match) throw new Error('缺少 multipart boundary。');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {}, files = {};
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const next = buffer.indexOf(boundary, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;
    const data = buffer.slice(dataStart, dataEnd);
    const name = /name="([^"]+)"/.exec(headerText)?.[1];
    const filename = /filename="([^"]*)"/.exec(headerText)?.[1];
    const contentTypePart = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || 'application/octet-stream';
    if (name) {
      if (filename !== undefined) files[name] = { filename, contentType: contentTypePart, data };
      else fields[name] = data.toString('utf8');
    }
    start = next;
  }
  return { fields, files };
}

function json(res, status, data) { const body = JSON.stringify(data, null, 2); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(body); }
function text(res, status, body) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); }
function mimeType(file) { const ext = path.extname(file).toLowerCase(); return { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg' }[ext] || 'application/octet-stream'; }
function extensionFromMime(mime = '') { if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3'; if (mime.includes('wav')) return '.wav'; if (mime.includes('mp4') || mime.includes('aac')) return '.m4a'; if (mime.includes('webm')) return '.webm'; if (mime.includes('ogg')) return '.ogg'; return ''; }
function sanitizeName(name) { return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名声音样本'; }
function safeConfig(config) { return { indexRoot: config.indexRoot, pythonExe: config.pythonExe, ffmpegExe: config.ffmpegExe, localTtsExe: config.localTtsExe, defaultMode: config.defaultMode, defaultModel: config.defaultModel, cosyVoice2: config.cosyVoice2 }; }

const port = Number(process.env.PORT || 3010);
server.listen(port, '127.0.0.1', () => {
  console.log(`Voice clone web app: http://127.0.0.1:${port}`);
  console.log(`Using Index-TTS root: ${readConfig().indexRoot}`);
});




