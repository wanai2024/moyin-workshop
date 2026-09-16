/* ════════════════════════════════════════════════════════════
 * 魔音工坊 · 主逻辑
 * 状态管理 / 合成请求 / 播放下载 / 历史记录 / 设置 / Toast
 * 依赖：voices.js（先于本文件加载）
 * ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 常量 ─────────────────────────────────────────────────── */
  const KEY_SETTINGS = 'moyin.settings';
  const KEY_HISTORY = 'moyin.history';
  const MAX_CHARS = 1000;
  const PRICE_PER_10K = 2.5; // 元 / 万字符
  const HISTORY_LIMIT = 20;
  const HISTORY_AUDIO_MAX = 3 * 1024 * 1024; // 单条音频 base64 上限 3MB
  const SPEECH_PATH = '/v1/audio/speech';
  const MODEL = 'stepaudio-3-tts';

  const { VOICES, GROUPS, SCENE_LABELS, VOICE_LABEL_OPTIONS, FORMATS, DEFAULT_PREVIEW_TEXT } = window.MOYIN_VOICES;

  const MIME = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    opus: 'audio/ogg',
    pcm: 'application/octet-stream',
  };

  const DEFAULT_SETTINGS = {
    apiKey: '',
    apiBase: 'https://api.stepfun.com',
    voice: 'jingdiannvsheng',
    customVoice: '',
    volume: 1.0,
    speed: 1.0,
    format: 'mp3',
    sampleRate: 24000,
    voiceLabel: { type: 'none', value: '' },
    previewText: DEFAULT_PREVIEW_TEXT,
    autoPlay: false,
  };

  const EXAMPLE_TEXT =
    '夜色渐深，城市的灯火次第亮起。有人在写字楼里敲下最后一行代码，有人在厨房为自己煮一碗热汤。' +
    '生活从不总是轰轰烈烈，更多的是这些细碎而温柔的瞬间。愿你忙碌一天之后，也能被这样的夜晚轻轻拥抱。';

  /* ── DOM 引用 ─────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  const els = {
    textInput: $('textInput'), charCount: $('charCount'),
    btnExample: $('btnExample'), btnClear: $('btnClear'),
    volume: $('volumeSlider'), volumeValue: $('volumeValue'),
    speed: $('speedSlider'), speedValue: $('speedValue'),
    advanced: $('advancedPanel'),
    format: $('formatSelect'), sampleRate: $('sampleRateSelect'),
    vlBtns: Array.from(document.querySelectorAll('.vl-type-btn')),
    vlValue: $('voiceLabelValue'),
    voiceSearch: $('voiceSearch'), filterTabs: $('filterTabs'),
    voiceGrid: $('voiceGrid'), voiceEmpty: $('voiceEmpty'), voiceCount: $('voiceCount'),
    customVoice: $('customVoiceInput'),
    statusText: $('statusText'), estimateChars: $('estimateChars'), estimateCost: $('estimateCost'),
    statusReady: $('statusReady'), statusCustom: $('statusCustom'),
    summaryVoice: $('summaryVoice'), summaryVolume: $('summaryVolume'),
    summarySpeed: $('summarySpeed'), summaryFormat: $('summaryFormat'),
    btnSynthesize: $('btnSynthesize'), synthesizeLabel: $('synthesizeLabel'),
    playerShell: $('playerShell'), playBtn: $('playBtn'),
    playerName: $('playerName'), playerEq: $('playerEq'), playerNote: $('playerNote'),
    timeCurrent: $('timeCurrent'), timeTotal: $('timeTotal'),
    progressBar: $('progressBar'), progressFill: document.querySelector('.progress-fill'),
    btnReplay: $('btnReplay'), btnDownload: $('btnDownload'),
    audio: $('audioElement'),
    btnSettings: $('btnSettings'), settingsModal: $('settingsModal'), btnCloseSettings: $('btnCloseSettings'),
    apiKeyInput: $('apiKeyInput'), btnToggleKey: $('btnToggleKey'), btnSaveKey: $('btnSaveKey'),
    btnClearKey: $('btnClearKey'), keyStatus: $('keyStatus'),
    apiBaseInput: $('apiBaseInput'), previewTextInput: $('previewTextInput'),
    autoPlaySwitch: $('autoPlaySwitch'), btnWipeData: $('btnWipeData'),
    keyNotice: $('keyNotice'), noticeTitle: $('noticeTitle'), noticeText: $('noticeText'),
    btnNoticeSettings: $('btnNoticeSettings'),
    btnHistory: $('btnHistory'), historyDrawer: $('historyDrawer'), btnCloseHistory: $('btnCloseHistory'),
    historyList: $('historyList'), historyEmpty: $('historyEmpty'), historyCount: $('historyCount'),
    toastRegion: $('toastRegion'),
  };

  /* ── 状态 ─────────────────────────────────────────────────── */
  let settings = loadSettings();
  let history = loadHistory();
  let requestBusy = false;          // 全局单请求锁（合成 / 试听互斥）
  let currentBlob = null;           // 最近一次合成的音频
  let currentFormat = 'mp3';
  let currentAudioURL = null;       // 播放器占用的 ObjectURL
  let playErrorNotified = false;
  let previewAudio = null;          // 试听音频实例
  let previewBtnEl = null;          // 正在播放的试听按钮
  let filterGroup = 'all';
  let searchTerm = '';

  /* ══════════════ 工具函数 ══════════════ */

  function loadSettings() {
    try {
      const raw = localStorage.getItem(KEY_SETTINGS);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed, voiceLabel: { ...DEFAULT_SETTINGS.voiceLabel, ...(parsed.voiceLabel || {}) } };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); } catch { /* 空间不足时静默，不影响主流程 */ }
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(KEY_HISTORY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, HISTORY_LIMIT) : [];
    } catch { return []; }
  }

  function saveHistory() {
    try { localStorage.setItem(KEY_HISTORY, JSON.stringify(history)); }
    catch { /* 超出配额：降级为只存参数（去掉音频）后重试一次 */
      try {
        history = history.map((h) => ({ ...h, audioBase64: null }));
        localStorage.setItem(KEY_HISTORY, JSON.stringify(history));
      } catch { /* 仍失败则放弃持久化 */ }
    }
  }

  function findVoice(id) { return VOICES.find((v) => v.id === id) || null; }

  function currentVoiceId() { return (settings.customVoice || '').trim() || settings.voice; }

  function currentVoiceName() {
    if ((settings.customVoice || '').trim()) return `自定义·${settings.customVoice.trim()}`;
    const v = findVoice(settings.voice);
    return v ? v.name : settings.voice;
  }

  function estimateCostYuan(chars) {
    return (chars / 10000) * PRICE_PER_10K;
  }

  /** 刷新合成卡片顶部的当前配置摘要 */
  function updateSummary() {
    if (!els.summaryVoice) return;
    els.summaryVoice.textContent = currentVoiceName();
    els.summaryVoice.title = currentVoiceId();
    els.summaryVolume.textContent = Number(settings.volume).toFixed(1);
    els.summarySpeed.textContent = Number(settings.speed).toFixed(1);
    const fmt = (settings.format || 'mp3').toUpperCase();
    const sr = settings.sampleRate >= 1000
      ? `${Math.round(settings.sampleRate / 1000)}k`
      : String(settings.sampleRate);
    els.summaryFormat.textContent = `${fmt} · ${sr}`;
    // 自定义音色生效时高亮提示
    els.summaryVoice.classList.toggle('is-custom', !!(settings.customVoice || '').trim());
  }

  function formatCost(yuan) {
    if (yuan === 0) return '';
    if (yuan < 0.01) return `（约 ¥${yuan.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}）`;
    return `（约 ¥${yuan.toFixed(2)}）`;
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function timestampForName(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function joinUrl(base, path) {
    return (base || '').trim().replace(/\/+$/, '') + path;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /* ══════════════ Toast ══════════════ */

  const TOAST_ICONS = {
    success: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m6 9.2 2 2 4-4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m6.4 6.4 5.2 5.2M11.6 6.4l-5.2 5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 18 18"><path d="M9 2.2 1.8 15.4h14.4L9 2.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="13.3" r=".9" fill="currentColor"/></svg>',
    info: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8v5M9 5.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  function toast(msg, type = 'info', duration = 4000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
      <span class="toast-msg"></span>
      <button type="button" class="toast-close" aria-label="关闭提示">
        <svg viewBox="0 0 12 12"><path d="m2.5 2.5 7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>`;
    el.querySelector('.toast-msg').textContent = msg;
    const remove = () => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400); // 兜底
    };
    el.querySelector('.toast-close').addEventListener('click', remove);
    els.toastRegion.appendChild(el);
    while (els.toastRegion.children.length > 4) els.toastRegion.firstElementChild.remove();
    if (duration > 0) setTimeout(remove, duration);
  }

  /* ══════════════ 文案输入区 ══════════════ */

  function refreshTextState() {
    const len = els.textInput.value.length;
    els.charCount.textContent = len;
    const over = len > MAX_CHARS;
    els.textInput.classList.toggle('over-limit', over);
    els.charCount.parentElement.classList.toggle('over-limit', over);

    const trim = els.textInput.value.trim();
    const chars = trim.length;
    els.estimateChars.textContent = chars;
    els.estimateCost.textContent = chars ? formatCost(estimateCostYuan(chars)) : '';

    els.btnClear.disabled = len === 0;
    if (over) {
      setStatus(`已超出 ${len - MAX_CHARS} 字符，请精简文案`, 'err');
      els.btnSynthesize.disabled = true;
    } else if (requestBusy) {
      els.btnSynthesize.disabled = true;
    } else {
      els.btnSynthesize.disabled = false;
      setStatus(null);
    }
  }

  /** 切换状态行：传 msg 显示自定义消息，传 null 回到「就绪 · 预计消耗」默认态。
   *  默认态的元素结构固定不重建，避免 estimateChars/estimateCost 的 id 丢失。 */
  function setStatus(msg, type = '') {
    els.statusText.className = `status-text ${type}`;
    const custom = !!msg;
    if (custom) els.statusCustom.textContent = msg;
    els.statusCustom.hidden = !custom;
    els.statusReady.hidden = custom;
  }

  function handlePasteTruncate() {
    const v = els.textInput.value;
    if (v.length > MAX_CHARS) {
      els.textInput.value = v.slice(0, MAX_CHARS);
      toast(`粘贴内容过长，已自动截断到 ${MAX_CHARS} 字符`, 'warn');
      refreshTextState();
    }
  }

  /* ══════════════ 声音调节 ══════════════ */

  function paintSlider(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const v = parseFloat(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
  }

  function bindSlider(input, output, key, decimals = 1) {
    const sync = () => {
      const v = parseFloat(input.value);
      settings[key] = v;
      output.textContent = v.toFixed(decimals);
      paintSlider(input);
      saveSettings();
      updateSummary();
    };
    input.addEventListener('input', sync);
    input.addEventListener('dblclick', () => { // 双击复位 1.0
      input.value = '1.0';
      sync();
      toast(`${input.getAttribute('aria-label').split('，')[0]}已复位为 1.0`, 'info', 1800);
    });
  }

  /* ══════════════ 音色区 ══════════════ */

  function voiceMatches(v) {
    const g = GROUPS.find((x) => x.key === filterGroup);
    if (g && !g.match(v)) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!v.name.toLowerCase().includes(q) && !v.id.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function renderVoiceGrid() {
    const list = VOICES.filter(voiceMatches);
    els.voiceGrid.innerHTML = '';
    els.voiceEmpty.hidden = list.length > 0;
    els.voiceCount.textContent = `${list.length} 个音色`;

    const frag = document.createDocumentFragment();
    list.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'voice-card' + (!settings.customVoice && v.id === settings.voice ? ' selected' : '');
      card.style.setProperty('--i', i);
      card.dataset.voiceId = v.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `选择音色 ${v.name}`);
      card.innerHTML = `
        <div class="voice-card-top">
          <span class="voice-avatar ${v.gender === 'male' ? 'm' : 'f'}" aria-hidden="true">${v.name[0]}</span>
          <div style="min-width:0">
            <div class="voice-name">${v.name}</div>
          </div>
        </div>
        <div class="voice-meta">
          <span class="voice-tag">${v.gender === 'male' ? '♂ 男' : '♀ 女'}</span>
          ${v.scenes.map((s) => `<span class="voice-tag">${SCENE_LABELS[s] || s}</span>`).join('')}
        </div>
        <div class="voice-id" title="${v.id}">${v.id}</div>
        <button type="button" class="voice-preview-btn" data-preview="${v.id}" aria-label="试听音色 ${v.name}" title="试听该音色">
          <svg viewBox="0 0 12 12"><path d="M3 1.8v8.4c0 .5.6.8 1 .5l6-4.2c.4-.3.4-.9 0-1.1l-6-4.2c-.4-.2-1 .1-1 .6Z" fill="currentColor"/></svg>
        </button>`;
      frag.appendChild(card);
    });
    els.voiceGrid.appendChild(frag);
  }

  function refreshVoiceSelection() {
    els.voiceGrid.querySelectorAll('.voice-card').forEach((c) => {
      c.classList.toggle('selected', !settings.customVoice && c.dataset.voiceId === settings.voice);
    });
    els.customVoice.classList.toggle('active', !!settings.customVoice);
  }

  function selectVoice(id) {
    settings.voice = id;
    settings.customVoice = '';
    els.customVoice.value = '';
    saveSettings();
    refreshVoiceSelection();
    updateSummary();
  }

  function bindVoiceEvents() {
    els.voiceSearch.addEventListener('input', () => {
      searchTerm = els.voiceSearch.value.trim();
      renderVoiceGrid();
    });

    els.filterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-tab');
      if (!btn) return;
      filterGroup = btn.dataset.group;
      els.filterTabs.querySelectorAll('.filter-tab').forEach((t) => {
        const active = t === btn;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      renderVoiceGrid();
    });

    els.voiceGrid.addEventListener('click', (e) => {
      const previewBtn = e.target.closest('.voice-preview-btn');
      if (previewBtn) {
        e.stopPropagation();
        previewVoice(previewBtn.dataset.preview, previewBtn);
        return;
      }
      const card = e.target.closest('.voice-card');
      if (card) selectVoice(card.dataset.voiceId);
    });

    els.voiceGrid.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.voice-card');
      if (card) {
        e.preventDefault();
        selectVoice(card.dataset.voiceId);
      }
    });

    els.customVoice.addEventListener('input', () => {
      const v = els.customVoice.value.trim();
      settings.customVoice = v;
      saveSettings();
      refreshVoiceSelection();
      updateSummary();
    });
    els.customVoice.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.customVoice.blur();
        toast(settings.customVoice ? `已应用自定义音色：${settings.customVoice}` : '已恢复选择官方音色', 'info', 2200);
      }
    });
  }

  /* ══════════════ 高级选项 ══════════════ */

  function setVoiceLabelType(type) {
    settings.voiceLabel.type = type;
    settings.voiceLabel.value = '';
    els.vlBtns.forEach((b) => {
      const active = b.dataset.vlType === type;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    els.vlValue.innerHTML = '';
    if (type === 'none') {
      els.vlValue.disabled = true;
      els.vlValue.innerHTML = '<option value="">—</option>';
    } else {
      els.vlValue.disabled = false;
      els.vlValue.innerHTML = '<option value="">— 请选择 —</option>' +
        VOICE_LABEL_OPTIONS[type].map((x) => `<option value="${x}">${x}</option>`).join('');
    }
    saveSettings();
  }

  function bindAdvanced() {
    els.format.addEventListener('change', () => {
      settings.format = els.format.value;
      if (currentBlob) showPlayabilityNote();
      saveSettings();
      updateSummary();
    });
    els.sampleRate.addEventListener('change', () => {
      settings.sampleRate = parseInt(els.sampleRate.value, 10);
      saveSettings();
      updateSummary();
    });
    els.vlBtns.forEach((b) => b.addEventListener('click', () => setVoiceLabelType(b.dataset.vlType)));
    els.vlValue.addEventListener('change', () => {
      settings.voiceLabel.value = els.vlValue.value;
      saveSettings();
    });
  }

  /* ══════════════ API 请求 ══════════════ */

  function buildRequestBody(text, voice, opts = {}) {
    const body = {
      model: MODEL,
      input: text,
      voice,
      volume: opts.volume ?? settings.volume,
      speed: opts.speed ?? settings.speed,
      response_format: opts.format ?? settings.format,
      sample_rate: opts.sampleRate ?? settings.sampleRate,
      text_normalization: 'standard',
    };
    if (opts.voiceLabel === undefined) {
      const { type, value } = settings.voiceLabel;
      if (type !== 'none' && value) body.voice_label = { [type]: value };
    } else if (opts.voiceLabel) {
      body.voice_label = opts.voiceLabel;
    }
    return body;
  }

  /** 发起合成请求，成功返回音频 Blob；失败抛出带中文信息的 Error */
  async function requestSpeech(body) {
    const url = joinUrl(settings.apiBase, SPEECH_PATH);
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('网络异常，请检查网络或 API 地址设置');
    }

    if (!resp.ok) {
      let apiMsg = '', apiType = '';
      try {
        const data = await resp.json();
        apiMsg = data?.error?.message || '';
        apiType = data?.error?.type || '';
      } catch { /* 响应体非 JSON 时忽略 */ }
      const suffix = apiMsg ? `：${apiMsg}` : '';
      // 内容风控拦截（451 censorship_blocked）：平台对文案或当前网络环境做了审查阻断
      if (resp.status === 451 || apiType === 'censorship_blocked') {
        throw new Error('内容被风控拦截，暂无法合成。可能是文案或当前网络环境触发了平台内容审查，请调整文案、稍后重试或更换网络环境');
      }
      switch (resp.status) {
        case 400: throw new Error(`请求参数错误${suffix || '，请检查文本、音色与标签设置'}`);
        case 401: throw new Error('API Key 无效，请到设置中检查');
        case 402: throw new Error(`余额不足${suffix || '，请前往 platform.stepfun.com 充值'}`);
        case 403: throw new Error(`无权限访问该接口${suffix}`);
        case 429: throw new Error(`请求过于频繁已触发限流，请稍后再试${suffix}`);
        default:
          if (resp.status >= 500) throw new Error(`服务异常（${resp.status}），请稍后重试${suffix}`);
          throw new Error(`请求失败（HTTP ${resp.status}）${suffix}`);
      }
    }

    const blob = await resp.blob();
    if (!blob || blob.size === 0) throw new Error('接口返回了空音频，请重试');
    // 某些错误以 200 + JSON 返回的兜底识别
    if (/json|text/i.test(blob.type)) {
      let msg = '接口返回异常';
      try {
        const data = JSON.parse(await blob.text());
        msg = data?.error?.message || msg;
      } catch { /* 保持默认 */ }
      throw new Error(msg);
    }
    return blob;
  }

  /* ══════════════ 合成主流程 ══════════════ */

  function setSynthesizeLoading(loading) {
    els.btnSynthesize.classList.toggle('loading', loading);
    els.btnSynthesize.disabled = loading || els.textInput.value.length > MAX_CHARS;
    els.synthesizeLabel.textContent = loading ? '合成中' : '合成配音';
  }

  async function synthesize() {
    if (requestBusy) {
      toast('请等待当前任务完成', 'warn', 2500);
      return;
    }
    if (!settings.apiKey) {
      toast('请先在设置中填写 API Key', 'warn');
      openSettings(true);
      return;
    }
    const text = els.textInput.value.trim();
    if (!text) {
      toast('请先输入配音文案', 'warn');
      els.textInput.focus();
      return;
    }
    if (text.length > MAX_CHARS) {
      toast(`文案超过 ${MAX_CHARS} 字符上限`, 'err');
      return;
    }

    stopPreview();
    requestBusy = true;
    setSynthesizeLoading(true);
    const chars = text.length;
    setStatus(`合成中 · 正在请求接口（${chars} 字符）…`, 'warn');

    try {
      const body = buildRequestBody(text, currentVoiceId());
      const blob = await requestSpeech(body);
      setPlayerSource(blob, {
        name: `${currentVoiceName()} · ${FORMATS[settings.format]?.ext.toUpperCase() || ''} · ${settings.sampleRate} Hz`,
        format: settings.format,
      });
      await addHistoryEntry(text, blob);
      setStatus(`合成完成 · 消耗 ${chars} 字符${formatCost(estimateCostYuan(chars))}`);
      toast('合成完成，可以试听与下载了', 'success', 2600);
      if (settings.autoPlay) playAudio();
      els.playerShell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      setStatus(`合成失败 · ${err.message}`, 'err');
      toast(err.message, 'error', 5200);
    } finally {
      requestBusy = false;
      setSynthesizeLoading(false);
    }
  }

  /* ══════════════ 音色试听 ══════════════ */

  async function previewVoice(voiceId, btnEl) {
    if (requestBusy) {
      toast('请等待当前任务完成', 'warn', 2500);
      return;
    }
    if (!settings.apiKey) {
      toast('试听也需要 API Key，请先在设置中填写', 'warn');
      openSettings(true);
      return;
    }

    // 同一按钮再点一次 = 停止
    if (previewAudio && previewBtnEl === btnEl) {
      stopPreview();
      return;
    }
    stopPreview();
    pauseAudio();

    const text = settings.previewText?.trim() || DEFAULT_PREVIEW_TEXT;
    requestBusy = true;
    btnEl.classList.add('loading');
    toast(`正在试听「${findVoice(voiceId)?.name || voiceId}」，将消耗 ${text.length} 字符费用`, 'info', 2600);

    try {
      const blob = await requestSpeech(buildRequestBody(text, voiceId, {
        volume: 1.0, speed: 1.0, format: 'mp3', sampleRate: 24000, voiceLabel: null,
      }));
      const url = URL.createObjectURL(blob);
      previewAudio = new Audio(url);
      previewBtnEl = btnEl;
      btnEl.classList.remove('loading');
      btnEl.classList.add('playing');
      previewAudio.addEventListener('ended', () => stopPreview());
      previewAudio.addEventListener('error', () => {
        stopPreview();
        toast('试听播放失败，请重试', 'error');
      });
      await previewAudio.play();
    } catch (err) {
      btnEl.classList.remove('loading', 'playing');
      previewAudio = null;
      previewBtnEl = null;
      toast(err.message, 'error', 5200);
    } finally {
      requestBusy = false;
    }
  }

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause();
      if (previewAudio.src?.startsWith('blob:')) URL.revokeObjectURL(previewAudio.src);
      previewAudio = null;
    }
    if (previewBtnEl) {
      previewBtnEl.classList.remove('loading', 'playing');
      previewBtnEl = null;
    }
  }

  /* ══════════════ 播放器 ══════════════ */

  function setPlayerSource(blob, { name, format }) {
    if (currentAudioURL) URL.revokeObjectURL(currentAudioURL);
    playErrorNotified = false;
    currentBlob = blob;
    currentFormat = format;

    els.playerShell.hidden = false;
    els.playerName.textContent = name;
    els.progressFill.style.width = '0%';
    els.progressBar.setAttribute('aria-valuenow', '0');
    els.timeCurrent.textContent = '00:00';
    els.timeTotal.textContent = '00:00';

    const playable = FORMATS[format]?.playable !== false;
    els.playBtn.disabled = !playable;
    showPlayabilityNote();

    if (playable) {
      currentAudioURL = URL.createObjectURL(blob);
      els.audio.src = currentAudioURL;
      els.audio.load();
    } else {
      els.audio.removeAttribute('src');
      currentAudioURL = null;
    }
  }

  function showPlayabilityNote() {
    const playable = FORMATS[currentFormat]?.playable !== false;
    if (currentBlob && !playable) {
      els.playerNote.hidden = false;
      els.playerNote.textContent = 'PCM 为无容器原始音频流，浏览器无法直接试听，请下载后使用。';
    } else {
      els.playerNote.hidden = true;
    }
  }

  function playAudio() {
    if (els.playBtn.disabled) return;
    stopPreview();
    els.audio.play().catch(() => toast('浏览器阻止了自动播放，请点击播放按钮', 'warn', 2600));
  }

  function pauseAudio() {
    if (!els.audio.paused) els.audio.pause();
  }

  function updatePlayUI() {
    const playing = !els.audio.paused && !els.audio.ended;
    els.playBtn.classList.toggle('playing', playing);
    els.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    els.playerEq.classList.toggle('on', playing);
  }

  function updateProgressUI() {
    const d = els.audio.duration;
    const c = els.audio.currentTime;
    const pct = Number.isFinite(d) && d > 0 ? (c / d) * 100 : 0;
    els.progressFill.style.width = `${pct}%`;
    els.progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    els.timeCurrent.textContent = formatTime(c);
    els.timeTotal.textContent = formatTime(d);
  }

  function seekTo(clientX) {
    const rect = els.progressBar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const d = els.audio.duration;
    if (Number.isFinite(d)) els.audio.currentTime = ratio * d;
    updateProgressUI();
  }

  function downloadAudio() {
    if (!currentBlob) return;
    const ext = FORMATS[currentFormat]?.ext || 'bin';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(currentBlob);
    a.download = `魔音工坊-${currentVoiceName()}-${timestampForName()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    toast(`已开始下载：${a.download}`, 'success', 2600);
  }

  function bindPlayer() {
    els.playBtn.addEventListener('click', () => {
      if (els.audio.paused) playAudio();
      else pauseAudio();
    });
    els.audio.addEventListener('play', updatePlayUI);
    els.audio.addEventListener('pause', updatePlayUI);
    els.audio.addEventListener('ended', updatePlayUI);
    els.audio.addEventListener('timeupdate', updateProgressUI);
    els.audio.addEventListener('loadedmetadata', updateProgressUI);
    els.audio.addEventListener('error', () => {
      updatePlayUI();
      if (!playErrorNotified && currentBlob) {
        playErrorNotified = true;
        toast('当前浏览器不支持该格式的在线播放，请下载后试听', 'warn', 4200);
      }
    });

    // 进度条拖拽（Pointer Events）
    let dragging = false;
    els.progressBar.addEventListener('pointerdown', (e) => {
      if (els.playBtn.disabled) return;
      dragging = true;
      els.progressBar.classList.add('dragging');
      els.progressBar.setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    });
    els.progressBar.addEventListener('pointermove', (e) => {
      if (dragging) seekTo(e.clientX);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      els.progressBar.classList.remove('dragging');
      if (e.type === 'pointerup') seekTo(e.clientX);
    };
    els.progressBar.addEventListener('pointerup', endDrag);
    els.progressBar.addEventListener('pointercancel', endDrag);

    // 键盘左右微调
    els.progressBar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.key === 'ArrowLeft' ? -5 : 5);
        els.audio.currentTime = Math.min(els.audio.duration || 0, Math.max(0, els.audio.currentTime + step));
      }
    });

    els.btnReplay.addEventListener('click', () => {
      els.audio.currentTime = 0;
      playAudio();
    });
    els.btnDownload.addEventListener('click', downloadAudio);
  }

  /* ══════════════ 历史记录 ══════════════ */

  async function addHistoryEntry(text, blob) {
    let audioBase64 = null;
    if (blob && blob.size <= HISTORY_AUDIO_MAX) {
      try { audioBase64 = await blobToBase64(blob); } catch { audioBase64 = null; }
    }
    history.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: Date.now(),
      text,
      voice: currentVoiceId(),
      voiceName: currentVoiceName(),
      volume: settings.volume,
      speed: settings.speed,
      format: settings.format,
      sampleRate: settings.sampleRate,
      audioBase64,
    });
    history = history.slice(0, HISTORY_LIMIT);
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    els.historyList.innerHTML = '';
    els.historyCount.textContent = `${history.length} 条`;
    els.historyEmpty.style.display = history.length ? 'none' : 'flex';

    const frag = document.createDocumentFragment();
    history.forEach((h) => {
      const d = new Date(h.time);
      const p = (n) => String(n).padStart(2, '0');
      const timeStr = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;

      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div class="history-top">
          <span class="history-voice">🎙 ${h.voiceName || h.voice}</span>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-text" title="点击载入该条参数">${escapeHtml(h.text)}</div>
        <div class="history-meta">
          <span>音量 ${Number(h.volume).toFixed(1)}</span>
          <span>语速 ${Number(h.speed).toFixed(1)}</span>
          <span>${(h.format || 'mp3').toUpperCase()}</span>
          <span>${h.sampleRate || 24000} Hz</span>
          ${h.audioBase64
            ? `<span class="history-audio-badge"><svg viewBox="0 0 12 12"><path d="M2.5 1.5v9l7.5-4.5-7.5-4.5Z" fill="currentColor"/></svg>可回放</span>`
            : ''}
        </div>
        <div class="history-actions">
          <button type="button" class="ghost-btn" data-act="load">载入参数</button>
          <button type="button" class="ghost-btn" data-act="replay" ${h.audioBase64 ? '' : 'disabled'}>回放</button>
          <button type="button" class="ghost-btn" data-act="delete" style="margin-left:auto">删除</button>
        </div>`;
      frag.appendChild(item);
    });
    els.historyList.appendChild(frag);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function loadHistoryEntry(h) {
    els.textInput.value = h.text;
    refreshTextState();
    if (findVoice(h.voice)) {
      settings.voice = h.voice;
      settings.customVoice = '';
      els.customVoice.value = '';
    } else {
      settings.customVoice = h.voice;
      els.customVoice.value = h.voice;
    }
    settings.volume = h.volume;
    settings.speed = h.speed;
    els.volume.value = h.volume;
    els.speed.value = h.speed;
    els.volumeValue.textContent = Number(h.volume).toFixed(1);
    els.speedValue.textContent = Number(h.speed).toFixed(1);
    paintSlider(els.volume);
    paintSlider(els.speed);
    settings.format = h.format;
    els.format.value = h.format;
    settings.sampleRate = h.sampleRate;
    els.sampleRate.value = String(h.sampleRate);
    saveSettings();
    renderVoiceGrid();
    updateSummary();
    toast('已载入该条历史参数', 'success', 2200);
    closeDrawer();
    els.textInput.focus();
  }

  function replayHistoryEntry(h) {
    try {
      const blob = base64ToBlob(h.audioBase64, MIME[h.format] || 'audio/mpeg');
      setPlayerSource(blob, {
        name: `${h.voiceName || h.voice} · 历史回放 · ${(h.format || 'mp3').toUpperCase()}`,
        format: h.format || 'mp3',
      });
      playAudio();
      closeDrawer();
      toast('正在回放历史音频', 'info', 2200);
    } catch {
      toast('音频数据损坏，无法回放', 'error');
    }
  }

  function bindHistory() {
    els.btnHistory.addEventListener('click', () => openDrawer());
    els.btnCloseHistory.addEventListener('click', closeDrawer);
    els.historyDrawer.addEventListener('click', (e) => {
      if (e.target === els.historyDrawer) closeDrawer();
    });
    els.historyList.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const item = e.target.closest('.history-item');
      const idx = Array.from(els.historyList.children).indexOf(item);
      const h = history[idx];
      if (!h) return;
      if (btn.dataset.act === 'load') loadHistoryEntry(h);
      else if (btn.dataset.act === 'replay') replayHistoryEntry(h);
      else if (btn.dataset.act === 'delete') {
        history.splice(idx, 1);
        saveHistory();
        renderHistory();
        toast('已删除该条记录', 'info', 1800);
      }
    });
  }

  function openDrawer() {
    els.historyDrawer.hidden = false;
    renderHistory();
  }
  function closeDrawer() {
    els.historyDrawer.hidden = true;
  }

  /* ══════════════ 设置弹窗 ══════════════ */

  /** 右列 API Key 提示区块：未配置时引导去设置，已配置时降调为本地存储确认 */
  function updateKeyNotice() {
    if (!els.keyNotice) return;
    const has = !!settings.apiKey;
    els.keyNotice.classList.toggle('configured', has);
    els.noticeTitle.textContent = has ? 'API Key 已配置' : '还没有配置 API Key';
    els.noticeText.textContent = has
      ? '配音服务已就绪，随时可在「设置」中更换或清除 Key。'
      : '在「设置」中填入 StepFun API Key，即可开始使用配音服务，支持 36 种官方音色。';
    els.btnNoticeSettings.hidden = has;
  }

  function openSettings(focusKey = false) {
    els.settingsModal.hidden = false;
    els.apiKeyInput.value = settings.apiKey;
    els.apiBaseInput.value = settings.apiBase;
    els.previewTextInput.value = settings.previewText;
    els.autoPlaySwitch.setAttribute('aria-checked', String(!!settings.autoPlay));
    els.keyStatus.textContent = settings.apiKey ? '✓ 已保存' : '';
    els.keyStatus.className = 'key-status mono' + (settings.apiKey ? ' ok' : '');
    if (focusKey) setTimeout(() => els.apiKeyInput.focus(), 60);
  }

  function closeSettings() {
    els.settingsModal.hidden = true;
    // 关闭时把非 Key 字段也持久化（Key 只通过显式按钮保存/清除）
    const base = els.apiBaseInput.value.trim() || DEFAULT_SETTINGS.apiBase;
    settings.apiBase = base;
    settings.previewText = els.previewTextInput.value.trim() || DEFAULT_PREVIEW_TEXT;
    saveSettings();
  }

  async function verifyAndSaveKey() {
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      els.keyStatus.textContent = '请先输入 Key';
      els.keyStatus.className = 'key-status mono err';
      els.apiKeyInput.focus();
      return;
    }
    if (requestBusy) {
      toast('请等待当前任务完成', 'warn', 2500);
      return;
    }

    requestBusy = true;
    const btn = els.btnSaveKey;
    btn.disabled = true;
    btn.textContent = '验证中…';
    els.keyStatus.textContent = '';
    els.keyStatus.className = 'key-status mono';

    // 用待验证的 Key（尚未写入 settings）发一次 1 字符合成
    const prevKey = settings.apiKey;
    settings.apiKey = key;
    try {
      // 用极短英文文本验证：单字中文容易被平台内容风控误拦（451），英文稳定
      await requestSpeech(buildRequestBody('Hello', 'jingdiannvsheng', {
        volume: 1, speed: 1, format: 'mp3', sampleRate: 24000, voiceLabel: null,
      }));
      settings.apiBase = els.apiBaseInput.value.trim() || DEFAULT_SETTINGS.apiBase;
      settings.previewText = els.previewTextInput.value.trim() || DEFAULT_PREVIEW_TEXT;
      saveSettings();
      els.keyStatus.textContent = '✓ 验证通过，已保存';
      els.keyStatus.className = 'key-status mono ok';
      updateKeyNotice();
      toast('API Key 验证通过并已保存', 'success');
    } catch (err) {
      settings.apiKey = prevKey; // 还原旧 Key
      if (/API Key 无效/.test(err.message)) {
        els.keyStatus.textContent = '✗ Key 无效，未保存';
        els.keyStatus.className = 'key-status mono err';
        toast(err.message, 'error', 5200);
      } else {
        // 网络 / 限流等其他原因：先保存，给出提示
        settings.apiKey = key;
        settings.apiBase = els.apiBaseInput.value.trim() || DEFAULT_SETTINGS.apiBase;
        saveSettings();
        els.keyStatus.textContent = '△ 接口暂不可用，已先保存';
        els.keyStatus.className = 'key-status mono';
        toast(`验证未完成（${err.message}），Key 已先保存`, 'warn', 5200);
      }
    } finally {
      requestBusy = false;
      btn.disabled = false;
      btn.textContent = '验证并保存';
    }
  }

  function bindSettings() {
    els.btnSettings.addEventListener('click', () => openSettings());
    els.btnNoticeSettings.addEventListener('click', () => openSettings(true));
    els.btnCloseSettings.addEventListener('click', closeSettings);
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) closeSettings();
    });

    els.btnToggleKey.addEventListener('click', () => {
      const show = els.apiKeyInput.type === 'password';
      els.apiKeyInput.type = show ? 'text' : 'password';
      els.btnToggleKey.textContent = show ? '隐藏' : '显示';
    });

    els.btnSaveKey.addEventListener('click', verifyAndSaveKey);

    els.btnClearKey.addEventListener('click', () => {
      els.apiKeyInput.value = '';
      settings.apiKey = '';
      saveSettings();
      els.keyStatus.textContent = '已清除';
      els.keyStatus.className = 'key-status mono';
      updateKeyNotice();
      toast('API Key 已清除', 'info', 2200);
    });

    els.autoPlaySwitch.addEventListener('click', () => {
      const next = els.autoPlaySwitch.getAttribute('aria-checked') !== 'true';
      els.autoPlaySwitch.setAttribute('aria-checked', String(next));
      settings.autoPlay = next;
      saveSettings();
    });

    els.btnWipeData.addEventListener('click', () => {
      if (!confirm('确定清空本地数据吗？\n将删除 API Key、偏好设置与全部历史记录，不可恢复。')) return;
      try {
        localStorage.removeItem(KEY_SETTINGS);
        localStorage.removeItem(KEY_HISTORY);
      } catch { /* 忽略 */ }
      toast('本地数据已清空，即将刷新页面…', 'success', 1400);
      setTimeout(() => location.reload(), 1200);
    });
  }

  /* ══════════════ 快捷键 ══════════════ */

  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (els.settingsModal.hidden && els.historyDrawer.hidden) {
          e.preventDefault();
          synthesize();
        }
      } else if (e.key === 'Escape') {
        if (!els.settingsModal.hidden) closeSettings();
        else if (!els.historyDrawer.hidden) closeDrawer();
      }
    });
  }

  /* ══════════════ 初始化 ══════════════ */

  function init() {
    // 文案区
    els.textInput.addEventListener('input', refreshTextState);
    els.textInput.addEventListener('paste', () => setTimeout(handlePasteTruncate, 0));
    els.btnExample.addEventListener('click', () => {
      els.textInput.value = EXAMPLE_TEXT;
      refreshTextState();
      els.textInput.focus();
    });
    els.btnClear.addEventListener('click', () => {
      els.textInput.value = '';
      refreshTextState();
      els.textInput.focus();
    });

    // 调节区
    els.volume.value = settings.volume;
    els.speed.value = settings.speed;
    els.volumeValue.textContent = Number(settings.volume).toFixed(1);
    els.speedValue.textContent = Number(settings.speed).toFixed(1);
    paintSlider(els.volume);
    paintSlider(els.speed);
    bindSlider(els.volume, els.volumeValue, 'volume');
    bindSlider(els.speed, els.speedValue, 'speed');

    // 高级选项
    els.format.value = settings.format;
    els.sampleRate.value = String(settings.sampleRate);
    setVoiceLabelType(settings.voiceLabel.type || 'none');
    if (settings.voiceLabel.value) {
      els.vlValue.value = settings.voiceLabel.value;
      if (els.vlValue.value !== settings.voiceLabel.value) settings.voiceLabel.value = '';
    }
    bindAdvanced();

    // 音色区
    els.customVoice.value = settings.customVoice || '';
    renderVoiceGrid();
    bindVoiceEvents();

    // 合成 / 播放 / 历史 / 设置
    els.btnSynthesize.addEventListener('click', synthesize);
    bindPlayer();
    bindHistory();
    bindSettings();
    bindShortcuts();

    refreshTextState();
    updateSummary();
    updateKeyNotice();
    if (settings.apiKey) {
      els.keyStatus.textContent = '✓ 已保存';
    }

    // 首次使用引导：无 Key 时温和提示一次
    if (!settings.apiKey) {
      setTimeout(() => toast('欢迎使用魔音工坊！首次使用请点击右上角「设置」填写 API Key', 'info', 6000), 700);
    }
  }

  init();
})();
