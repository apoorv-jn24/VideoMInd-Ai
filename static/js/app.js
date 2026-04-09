/* ════════════════════════════════════════════════════════════
   VideoMind AI — JavaScript Application Logic
   ════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ──────────────────────────────────────────────────
const state = {
  apiKey:      sessionStorage.getItem('vmApiKey') || '',
  token:       null,
  filename:    '',
  selectedFile: null,
  quizData:    [],
  quizAnswers: {},
};

// ─── DOM Refs ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  // Settings
  btnSettings:      $('btn-settings'),
  settingsModal:    $('settings-modal'),
  btnCloseSettings: $('btn-close-settings'),
  inputApiKey:      $('input-api-key'),
  btnSaveKey:       $('btn-save-key'),

  // Upload
  dropZone:        $('drop-zone'),
  fileInput:       $('file-input'),
  dzIdle:          $('dz-idle'),
  dzSelected:      $('dz-selected'), // fixed from dzPreview
  dzUploading:     $('dz-uploading'),
  videoPreview:    $('video-preview'),
  videoFilename:   $('dz-filename-text'), // fixed from video-filename
  videoSize:       $('dz-filesize-text'), // fixed from video-size
  btnChangeVideo:  $('btn-change-file'), // fixed from btn-change-video
  btnUpload:       $('btn-upload'),
  uploadStatus:    $('upload-status-text'),
  progressBar:     $('progress-bar'),
  uploadSuccess:   $('upload-success'),
  successFilename: $('success-filename'),
  btnNewVideo:     $('btn-new-video'),

  // YouTube
  tabUploadFile:   $('tab-upload-file'),
  tabUploadYt:     $('tab-upload-yt'),
  panelUploadFile: $('panel-upload-file'),
  panelUploadYt:   $('panel-upload-yt'),
  ytUrlInput:      $('yt-url-input'),
  btnYtProcess:    $('btn-yt-process'),
  ytProcessing:    $('yt-processing'),
  ytDonePlaceholder: $('yt-done-placeholder'),
  playerArea:      $('player-area'),

  // Workspace
  workspace:       $('workspace'),
  wsFilename:      $('ws-filename'),

  // Tabs
  tabQa:           $('tab-qa'),
  tabSummary:      $('tab-summary'),
  tabQuiz:         $('tab-quiz'),
  tabTranscript:   $('tab-transcript'),
  panelQa:         $('panel-qa'),
  panelSummary:    $('panel-summary'),
  panelQuiz:       $('panel-quiz'),
  panelTranscript: $('panel-transcript'),

  // Q&A
  chatMessages:    $('chat-messages'),
  questionInput:   $('question-input'),
  btnAsk:          $('btn-ask'),

  // Workspace Actions (Q&A Panel)
  btnSummarizeGlobal: $('btn-summarize-global'),
  btnQuizGlobal:      $('btn-quiz-global'),
  quickQuizCount:     $('quick-quiz-count'),
  btnDownloadPdf:     $('btn-download-pdf-global'),

  // Summary
  btnSummarize:    $('btn-summarize-panel'), // renamed from btn-summarize to avoid confusion if needed, but checking index.html
  btnCopySummary:  $('btn-copy-summary'),
  summaryContent:  $('summary-content'),

  // Quiz
  btnQuiz:         $('btn-quiz-panel'),
  quizCount:       $('quiz-count'),
  quizContent:     $('quiz-content'),
  quizScore:       $('quiz-score'),

  // Transcript
  btnTranscript:   $('btn-transcript'),
  btnCopyTranscript: $('btn-copy-transcript'),
  transcriptContent: $('transcript-content'),

  // Toast
  toast:           $('toast'),
};

// ─── Toast Notifications ─────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'info', duration = 3500) {
  const t = els.toast;
  t.textContent = message;
  t.className = `toast ${type}`;
  t.hidden = false;
  // Force reflow for animation
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 300);
  }, duration);
}

// ─── Settings / API Key ──────────────────────────────────────
els.btnSettings.addEventListener('click', () => {
  els.inputApiKey.value = state.apiKey;
  els.settingsModal.hidden = false;
});

els.btnCloseSettings.addEventListener('click', () => {
  els.settingsModal.hidden = true;
});

els.settingsModal.addEventListener('click', (e) => {
  if (e.target === els.settingsModal) els.settingsModal.hidden = true;
});

els.btnSaveKey.addEventListener('click', () => {
  const key = els.inputApiKey.value.trim();
  if (!key) { showToast('Please enter your Groq API Key.', 'error'); return; }
  state.apiKey = key;
  sessionStorage.setItem('vmApiKey', key);
  els.settingsModal.hidden = true;
  showToast('✅ API Key saved for this session!', 'success');
});

// Pre-fill API key if already saved
if (state.apiKey) els.inputApiKey.value = state.apiKey;

// ─── Logout ──────────────────────────────────────────────────
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    // Navigate directly — server clears session and redirects to /auth
    window.location.href = '/logout';
  });
}



// ─── File Helpers ────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ─── Drop Zone ───────────────────────────────────────────────
function showDropState(state_name) {
  els.dzIdle.classList.toggle('hidden',      state_name !== 'idle');
  els.dzSelected.classList.toggle('hidden',  state_name !== 'selected');
  els.dzUploading.classList.toggle('hidden', state_name !== 'uploading');
}

// Drag & drop
els.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropZone.classList.add('drag-over');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag-over'));
els.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFileSelected(f);
});

// Click to browse
els.dropZone.addEventListener('click', (e) => {
  if (!e.target.closest('#btn-change-file')) els.fileInput.click();
});
els.dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
});

els.fileInput.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) handleFileSelected(f);
});

els.btnChangeVideo.addEventListener('click', (e) => {
  e.stopPropagation();
  els.fileInput.value = '';
  els.fileInput.click();
});

function handleFileSelected(file) {
  const allowed = ['video/mp4','video/quicktime','video/x-msvideo','video/x-matroska',
                   'video/webm','video/x-flv','video/mpeg','video/mp2t','video/x-m4v'];
  const ext = file.name.split('.').pop().toLowerCase();
  const allowedExt = ['mp4','mov','avi','mkv','webm','flv','mpeg','mpg','m4v','3gp'];

  if (!allowed.includes(file.type) && !allowedExt.includes(ext)) {
    showToast(`Unsupported file type: ${file.type || ext}`, 'error');
    return;
  }

  state.selectedFile = file;
  els.videoFilename.textContent = file.name;
  els.videoSize.textContent = formatBytes(file.size);

  const url = URL.createObjectURL(file);
  els.videoPreview.src = url;

  showDropState('selected');
  els.btnUpload.disabled = false;
  els.btnUpload.setAttribute('aria-disabled', 'false');
}

// ─── Upload Tabs ─────────────────────────────────────────────
els.tabUploadFile.addEventListener('click', () => {
  els.tabUploadFile.classList.add('active');
  els.tabUploadYt.classList.remove('active');
  els.panelUploadFile.classList.remove('hidden');
  els.panelUploadYt.classList.add('hidden');
});

els.tabUploadYt.addEventListener('click', () => {
  els.tabUploadYt.classList.add('active');
  els.tabUploadFile.classList.remove('active');
  els.panelUploadYt.classList.remove('hidden');
  els.panelUploadFile.classList.add('hidden');
});

// ─── Upload ──────────────────────────────────────────────────
els.btnUpload.addEventListener('click', uploadVideo);

async function uploadVideo() {
  if (!state.selectedFile) return;

  if (!state.apiKey) {
    showToast('⚙️ Please set your Groq API Key first (click ⚙️ in the nav).', 'error', 5000);
    return;
  }

  showDropState('uploading');
  els.uploadSuccess.classList.add('hidden');
  els.progressBar.style.width = '0%';

  // Animate progress bar (fake progress until server responds)
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 4, 85);
    els.progressBar.style.width = progress + '%';
  }, 400);

  els.uploadStatus.textContent = 'Extracting frames & transcribing audio...';

  const formData = new FormData();
  formData.append('video', state.selectedFile);
  formData.append('api_key', state.apiKey);

  try {
    els.uploadStatus.textContent = 'Analysing video with Groq AI...';
    const res  = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();

    clearInterval(progressInterval);
    els.progressBar.style.width = '100%';

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Upload failed');
    }

    state.token    = data.token;
    state.filename = data.display_name;

    // Show success
    await new Promise(r => setTimeout(r, 500));
    showDropState('selected');
    els.uploadSuccess.classList.remove('hidden');
    els.playerArea.classList.remove('hidden');
    els.ytDonePlaceholder.classList.add('hidden');
    els.successFilename.textContent = state.filename;

    // Reveal workspace
    els.workspace.classList.remove('hidden');
    els.wsFilename.textContent = state.filename;

    // Smooth scroll to workspace
    setTimeout(() => els.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    showToast('🎉 Video ready! Start asking questions.', 'success', 4000);

  } catch (err) {
    clearInterval(progressInterval);
    showDropState(state.selectedFile ? 'selected' : 'idle');
    showToast(`❌ ${err.message}`, 'error', 6000);
    console.error('Upload error:', err);
  }
}

// ─── YouTube Upload ──────────────────────────────────────────
els.btnYtProcess.addEventListener('click', processYoutube);

async function processYoutube() {
  const url = els.ytUrlInput.value.trim();
  if (!url) { showToast('Please enter a YouTube URL.', 'error'); return; }

  if (!state.apiKey) {
    showToast('⚙️ Please set your Groq API Key first.', 'error', 5000);
    return;
  }

  els.ytProcessing.classList.remove('hidden');
  els.btnYtProcess.disabled = true;

  try {
    const res = await fetch('/upload_yt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, api_key: state.apiKey })
    });
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'YouTube analysis failed');

    state.token = data.token;
    state.filename = data.display_name;

    // Show success
    els.uploadSuccess.classList.remove('hidden');
    els.playerArea.classList.add('hidden');
    els.ytDonePlaceholder.classList.remove('hidden');
    els.successFilename.textContent = state.filename;

    // Reveal workspace
    els.workspace.classList.remove('hidden');
    els.wsFilename.textContent = state.filename;
    setTimeout(() => els.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    showToast('🎉 YouTube video analysed! Start asking questions.', 'success', 4000);

  } catch (err) {
    showToast(`❌ ${err.message}`, 'error', 6000);
  } finally {
    els.ytProcessing.classList.add('hidden');
    els.btnYtProcess.disabled = false;
  }
}

// New video
els.btnNewVideo.addEventListener('click', resetUpload);

function resetUpload() {
  state.token       = null;
  state.filename    = '';
  state.selectedFile = null;
  state.quizData    = [];
  state.quizAnswers = {};

  els.fileInput.value   = '';
  els.videoPreview.src  = '';
  els.btnUpload.disabled = true;
  els.btnUpload.setAttribute('aria-disabled', 'true');
  els.uploadSuccess.classList.add('hidden');
  els.workspace.classList.add('hidden');
  els.summaryContent.innerHTML = '<div class="content-placeholder"><div class="placeholder-icon">📄</div><p>Click "Generate Summary" to get a structured breakdown of the video.</p></div>';
  els.quizContent.innerHTML   = '<div class="content-placeholder"><div class="placeholder-icon">🧠</div><p>Click "Generate Quiz" to test your understanding of the video.</p></div>';
  els.transcriptContent.innerHTML = '<div class="content-placeholder"><div class="placeholder-icon">📝</div><p>Click "Extract Transcript" to get a full transcript of the video\'s speech and events.</p></div>';
  els.chatMessages.innerHTML  = getChatWelcomeHTML();
  els.btnCopySummary.classList.add('hidden');
  els.btnCopyTranscript.classList.add('hidden');
  els.quizScore.classList.add('hidden');
  els.ytUrlInput.value = '';
  showDropState('idle');
  attachSampleQuestions();
}

// ─── Tabs ───────────────────────────────────────────────────
const tabMap = {
  qa:         { btn: els.tabQa,         panel: els.panelQa         },
  summary:    { btn: els.tabSummary,    panel: els.panelSummary    },
  quiz:       { btn: els.tabQuiz,       panel: els.panelQuiz       },
  transcript: { btn: els.tabTranscript, panel: els.panelTranscript },
};

Object.entries(tabMap).forEach(([key, {btn}]) => {
  btn.addEventListener('click', () => switchTab(key));
});

function switchTab(activeKey) {
  Object.entries(tabMap).forEach(([key, {btn, panel}]) => {
    const isActive = key === activeKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('active', isActive);
  });
}

// ─── Simple Markdown Renderer ────────────────────────────────
function renderMarkdown(text) {
  let html = text
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).replace(/^\w*\n/, '')}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // H2
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // H3
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    // Unordered lists
    .replace(/^[*\-] (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive li in ul
    .replace(/(<li>[\s\S]*?<\/li>)(\n<li>|$)/g, '$1$2')
    // Paragraphs (double newlines)
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap li groups
  html = html.replace(/(<li>.*?<\/li>(<br\/>)?)+/g, match => `<ul>${match}</ul>`);

  return `<div class="rendered-content"><p>${html}</p></div>`;
}

// ─── Q&A Chat ───────────────────────────────────────────────
function getChatWelcomeHTML() {
  return `
    <div class="chat-welcome">
      <div class="welcome-icon">🤖</div>
      <h3>Ready to Answer Your Questions!</h3>
      <p>Ask anything about the video — content, facts, timestamps, concepts, or anything else.</p>
      <div class="sample-questions">
        <p class="sq-label">Try asking:</p>
        <button class="sq-chip" data-question="What is the main topic of this video?">What is the main topic?</button>
        <button class="sq-chip" data-question="What are the key points discussed in this video?">Key points?</button>
        <button class="sq-chip" data-question="Who is speaking in this video and what are they explaining?">Who is speaking?</button>
        <button class="sq-chip" data-question="Give me a detailed explanation of what happens in this video.">Full explanation?</button>
      </div>
    </div>`;
}

function attachSampleQuestions() {
  els.chatMessages.querySelectorAll('.sq-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      els.questionInput.value = chip.dataset.question;
      sendQuestion();
    });
  });
}

// Attach on page load
attachSampleQuestions();

// Auto-resize textarea
els.questionInput.addEventListener('input', () => {
  els.questionInput.style.height = 'auto';
  els.questionInput.style.height = Math.min(els.questionInput.scrollHeight, 150) + 'px';
});

// Send on Enter (Shift+Enter for newline)
els.questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendQuestion();
  }
});

els.btnAsk.addEventListener('click', sendQuestion);

function clearWelcome() {
  const welcome = els.chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
}

function appendBubble(role, text, isTyping = false) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}${isTyping ? ' typing-bubble' : ''}`;
  const label = role === 'user' ? 'You' : '🤖 Groq AI';

  if (isTyping) {
    bubble.innerHTML = `
      <div class="bubble-label">${label}</div>
      <div class="bubble-content">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>`;
  } else {
    const contentHtml = role === 'user'
      ? `<p>${escapeHTML(text)}</p>`
      : renderMarkdown(text).replace(/<\/?div[^>]*>/g, '');    // strip outer div
    bubble.innerHTML = `
      <div class="bubble-label">${label}</div>
      <div class="bubble-content">${contentHtml}</div>`;
  }

  els.chatMessages.appendChild(bubble);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  return bubble;
}

function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function sendQuestion() {
  const question = els.questionInput.value.trim();
  if (!question) return;
  if (!state.token) { showToast('Please upload a video first.', 'error'); return; }

  clearWelcome();
  els.questionInput.value = '';
  els.questionInput.style.height = 'auto';

  appendBubble('user', question);
  const typingBubble = appendBubble('ai', '', true);

  els.btnAsk.disabled = true;

  try {
    const res  = await fetch('/ask', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: state.token, question, api_key: state.apiKey }),
    });
    const data = await res.json();

    typingBubble.remove();

    if (!res.ok || data.error) throw new Error(data.error || 'Failed to get answer');
    appendBubble('ai', data.answer);
  } catch (err) {
    typingBubble.remove();
    appendBubble('ai', `❌ Error: ${err.message}`);
  } finally {
    els.btnAsk.disabled = false;
    els.questionInput.focus();
  }
}

// ─── Summary ────────────────────────────────────────────────
els.btnSummarize.addEventListener('click', async () => {
  if (!state.token) { showToast('Please upload a video first.', 'error'); return; }

  els.summaryContent.innerHTML = `
    <div class="panel-loading">
      <div class="panel-spinner"></div>
      <p>Generating summary with Groq AI (Llama 3.3)...</p>
    </div>`;
  els.btnCopySummary.classList.add('hidden');
  els.btnSummarize.disabled = true;

  try {
    const res  = await fetch('/summarize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: state.token, api_key: state.apiKey }),
    });
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Summarization failed');

    els.summaryContent.innerHTML = `<div class="content-area">${renderMarkdown(data.summary)}</div>`;
    els.btnCopySummary.classList.remove('hidden');
    els.btnCopySummary.dataset.text = data.summary;
    showToast('✅ Summary generated!', 'success');
  } catch (err) {
    els.summaryContent.innerHTML = `<div class="content-area"><div class="content-placeholder"><p>❌ ${err.message}</p></div></div>`;
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    els.btnSummarize.disabled = false;
  }
});

// Bind Global Summary Button
if (els.btnSummarizeGlobal) {
  els.btnSummarizeGlobal.addEventListener('click', () => {
    switchTab('summary');
    els.btnSummarize.click();
  });
}

els.btnCopySummary.addEventListener('click', () => {
  copyText(els.btnCopySummary.dataset.text, els.btnCopySummary);
});

// ─── Quiz ────────────────────────────────────────────────────
els.btnQuiz.addEventListener('click', async () => {
  if (!state.token) { showToast('Please upload a video first.', 'error'); return; }

  const num = parseInt(els.quizCount.value, 10);
  els.quizContent.innerHTML = `
    <div class="panel-loading">
      <div class="panel-spinner"></div>
      <p>Crafting ${num} quiz questions with Groq AI...</p>
    </div>`;
  els.quizScore.classList.add('hidden');
  state.quizAnswers = {};
  els.btnQuiz.disabled = true;

  try {
    const res  = await fetch('/quiz', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: state.token, num_questions: num, api_key: state.apiKey }),
    });
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Quiz generation failed');

    state.quizData    = data.quiz;
    state.quizAnswers = {};
    renderQuiz(data.quiz);
    showToast('🧠 Quiz ready! Test your knowledge.', 'success');
  } catch (err) {
    els.quizContent.innerHTML = `<div class="content-placeholder" style="padding:3rem"><p>❌ ${err.message}</p></div>`;
    showToast(`❌ ${err.message}`, 'error');
    els.btnQuiz.disabled = false;
  }
});

// ─── PDF Download ───────────────────────────────────────────
if (els.btnDownloadPdf) {
  els.btnDownloadPdf.addEventListener('click', async () => {
    if (!state.token) { showToast('Please upload a video first.', 'error'); return; }
    
    // We need some text to actually put in the PDF. 
    // If summary exists, use it. Otherwise, toast.
    const summaryText = els.btnCopySummary.dataset.text;
    if (!summaryText) {
      showToast('Please generate a Summary before downloading.', 'info');
      switchTab('summary');
      return;
    }

    els.btnDownloadPdf.disabled = true;
    showToast('⚙️ Generating PDF...', 'info');

    try {
      const res = await fetch('/download_summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: state.token, summary: summaryText })
      });

      if (!res.ok) throw new Error('PDF generation failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Summary_${state.token.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('✅ PDF Downloaded!', 'success');
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      els.btnDownloadPdf.disabled = false;
    }
  });
}

// Bind Global Quiz Button
if (els.btnQuizGlobal) {
  els.btnQuizGlobal.addEventListener('click', () => {
    els.quizCount.value = els.quickQuizCount.value;
    switchTab('quiz');
    els.btnQuiz.click();
  });
}

function renderQuiz(questions) {
  const letters = ['A','B','C','D'];
  const html = questions.map((q, qi) => `
    <div class="quiz-question" id="question-${qi}" data-qi="${qi}">
      <div class="question-number">Question ${qi + 1} of ${questions.length}</div>
      <div class="question-text">${escapeHTML(q.question)}</div>
      <div class="quiz-options">
        ${q.options.map((opt, oi) => `
          <button
            class="quiz-option"
            data-qi="${qi}"
            data-oi="${oi}"
            aria-label="Option ${letters[oi]}: ${escapeHTML(opt)}"
          >
            <span class="option-letter">${letters[oi]}</span>
            ${escapeHTML(opt)}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  els.quizContent.innerHTML = `<div class="quiz-list">${html}</div>`;

  els.quizContent.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', handleQuizAnswer);
  });
}

function handleQuizAnswer(e) {
  const btn  = e.currentTarget;
  const qi   = parseInt(btn.dataset.qi, 10);
  const oi   = parseInt(btn.dataset.oi, 10);

  if (state.quizAnswers[qi] !== undefined) return;  // already answered
  state.quizAnswers[qi] = oi;

  const q = state.quizData[qi];
  const questionEl = $(`question-${qi}`);
  questionEl.classList.add('answered');

  // Mark all options in this question
  questionEl.querySelectorAll('.quiz-option').forEach((b, idx) => {
    b.disabled = true;
    if (idx === q.correct) b.classList.add('correct');
    else if (idx === oi)   b.classList.add('wrong');
  });

  // Show explanation
  const explanation = document.createElement('div');
  explanation.className = 'question-explanation';
  explanation.textContent = '💡 ' + q.explanation;
  questionEl.appendChild(explanation);

  // Check if all answered
  if (Object.keys(state.quizAnswers).length === state.quizData.length) {
    showQuizScore();
  }
}

function showQuizScore() {
  const correct = state.quizData.filter((q, i) => state.quizAnswers[i] === q.correct).length;
  const total   = state.quizData.length;
  const pct     = Math.round((correct / total) * 100);
  const emoji   = pct >= 80 ? '🏆' : pct >= 60 ? '👍' : pct >= 40 ? '📖' : '💪';

  els.quizScore.innerHTML = `
    <div class="score-num">${correct}/${total}</div>
    <div>${emoji} You scored <strong>${pct}%</strong></div>
    <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.5rem">
      ${pct >= 80 ? 'Excellent! You truly understood the video.' : pct >= 60 ? 'Good job! Review the missed questions.' : 'Keep learning! Re-watch the video and try again.'}
    </div>
  `;
  els.quizScore.classList.remove('hidden');
  els.quizScore.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Transcript ──────────────────────────────────────────────
els.btnTranscript.addEventListener('click', async () => {
  if (!state.token) { showToast('Please upload a video first.', 'error'); return; }

  els.transcriptContent.innerHTML = `
    <div class="panel-loading">
      <div class="panel-spinner"></div>
      <p>Loading transcript from Groq Whisper analysis...</p>
    </div>`;
  els.btnCopyTranscript.classList.add('hidden');
  els.btnTranscript.disabled = true;

  try {
    const res  = await fetch('/transcript', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: state.token, api_key: state.apiKey }),
    });
    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Transcript extraction failed');

    els.transcriptContent.innerHTML = `<div class="content-area">${renderMarkdown(data.transcript)}</div>`;
    els.btnCopyTranscript.classList.remove('hidden');
    els.btnCopyTranscript.dataset.text = data.transcript;
    showToast('✅ Transcript ready!', 'success');
  } catch (err) {
    els.transcriptContent.innerHTML = `<div class="content-area"><div class="content-placeholder"><p>❌ ${err.message}</p></div></div>`;
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    els.btnTranscript.disabled = false;
  }
});

els.btnCopyTranscript.addEventListener('click', () => {
  copyText(els.btnCopyTranscript.dataset.text, els.btnCopyTranscript);
});

// ─── Copy Helper ─────────────────────────────────────────────
async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
    showToast('Copied to clipboard!', 'success', 2000);
  } catch {
    showToast('Could not copy. Please select and copy manually.', 'error');
  }
}
