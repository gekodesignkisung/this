/**
 * THIS - Side Panel
 * Figma 디자인 기반 리팩토링
 * - 선택 모드 토글로 피커 토글
 * - 수정 이력 리스트 표시 + 되돌리기
 */

const editToggle   = document.getElementById('edit-toggle');
const editStatus   = document.getElementById('edit-status');
const historyList  = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const settingsBtn  = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const pathInput    = document.getElementById('project-path-input');
const pathSave     = document.getElementById('project-path-save');
const apiKeyInput  = document.getElementById('api-key-input');
const apiKeySave   = document.getElementById('api-key-save');
const settingsStatus = document.getElementById('settings-status');

let isActive = false;
const history = [];

// 서버 상태
async function checkServer() {
  try {
    const res = await fetch('http://127.0.0.1:3333/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      // 서버의 현재 경로를 input에 표시 (비어있는 경우만)
      if (data.projectRoot && !pathInput.value) {
        pathInput.value = data.projectRoot;
      }
    } else { throw new Error(); }
  } catch {
    // server offline
  }
}

// 설정 패널 토글
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  if (settingsPanel.classList.contains('open')) {
    pathInput.focus();
    pathInput.select();
  }
});

// 경로 저장
pathSave.addEventListener('click', saveProjectPath);
pathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveProjectPath();
});

async function saveProjectPath() {
  const newPath = pathInput.value.trim();
  if (!newPath) { setSettingsStatus('경로를 입력하세요', 'err'); return; }
  pathSave.disabled = true;
  try {
    const res = await fetch('http://127.0.0.1:3333/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectRoot: newPath }),
      signal: AbortSignal.timeout(3000),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      await chrome.storage.local.set({ projectRoot: newPath });
      setSettingsStatus('경로 저장됨', 'ok');
      closeSettingsDelayed();
    } else {
      setSettingsStatus(d.error || '저장 실패', 'err');
    }
  } catch { setSettingsStatus('서버에 연결할 수 없습니다', 'err'); }
  finally { pathSave.disabled = false; }
}

// API 키 저장
apiKeySave.addEventListener('click', saveApiKey);
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveApiKey();
});

async function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) { setSettingsStatus('API 키를 입력하세요', 'err'); return; }
  if (!key.startsWith('sk-')) { setSettingsStatus('올바른 Anthropic API 키 형식이 아닙니다', 'err'); return; }
  apiKeySave.disabled = true;
  try {
    const res = await fetch('http://127.0.0.1:3333/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
      signal: AbortSignal.timeout(3000),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      await chrome.storage.local.set({ apiKey: key });
      setSettingsStatus('API 키 저장됨', 'ok');
      closeSettingsDelayed();
    } else {
      setSettingsStatus(d.error || '저장 실패', 'err');
    }
  } catch { setSettingsStatus('서버에 연결할 수 없습니다', 'err'); }
  finally { apiKeySave.disabled = false; }
}

function closeSettingsDelayed() {
  setTimeout(() => { settingsPanel.classList.remove('open'); settingsStatus.textContent = ''; }, 1500);
}

function setSettingsStatus(text, cls) {
  settingsStatus.textContent = text;
  settingsStatus.className = 'settings-status ' + (cls || '');
}

// 저장된 설정 불러오기
async function loadSavedPath() {
  const data = await chrome.storage.local.get(['projectRoot', 'apiKey']);
  if (data.projectRoot) pathInput.value = data.projectRoot;
  if (data.apiKey) {
    apiKeyInput.value = data.apiKey;
    // 서버에도 자동 반영 (서버 재시작 후 초기화 복구)
    fetch('http://127.0.0.1:3333/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: data.apiKey, projectRoot: data.projectRoot }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  }
}

// 탭에 메시지 (content script 미주입 시 자동 재주입)
async function sendToTab(type, data) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...(data || {}) });
  } catch {
    // content script 가 아직 주입되지 않은 경우 → 직접 주입 후 재시도
    try {
      // 기존 로드 플래그 초기화 (이전 context 무효화 후 재주입 허용)
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { delete window.__thisExtLoaded; } });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await new Promise(r => setTimeout(r, 80));
      return await chrome.tabs.sendMessage(tab.id, { type, ...(data || {}) });
    } catch {
      return null;
    }
  }
}

// 편집 모드 토글
editToggle.addEventListener('change', async () => {
  if (editToggle.checked) {
    isActive = true;
    setEditStatus('요소를 클릭하세요', 'active');
    await sendToTab('ACTIVATE_PICKER');
  } else {
    deactivate();
    await sendToTab('DEACTIVATE_PICKER');
  }
});

function deactivate() {
  isActive = false;
  editToggle.checked = false;
  setEditStatus('');
}

function setEditStatus(text, cls) {
  editStatus.textContent = text;
  editStatus.className = 'edit-status ' + (cls || '');
}

// content.js 메시지 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ELEMENT_PICKED') {
    isActive = false;
    editToggle.checked = false;
    setEditStatus('처리 중...', '');
  }
  if (msg.type === 'PICK_DONE') {
    addHistory({
      selector: msg.selector || '알 수 없음',
      name: msg.selector || '요소',
      description: msg.description || '수정 완료',
      file: msg.file || null,
      changeId: msg.changeId || null,
    });
    isActive = true;
    editToggle.checked = true;
    setEditStatus('요소를 클릭하세요', 'active');
    sendToTab('ACTIVATE_PICKER');
  }
  if (msg.type === 'PICK_CANCELLED') {
    deactivate();
  }
});

// 이력 추가
function addHistory(item) {
  history.unshift(item);
  if (history.length > 10) history.splice(10);
  renderHistory();
}

function renderHistory() {
  historyEmpty.style.display = history.length === 0 ? 'block' : 'none';
  historyList.querySelectorAll('.history-item').forEach(el => el.remove());
  history.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML =
      '<div class="history-info">' +
        '<div class="history-name">' + esc(item.name) + '</div>' +
        '<div class="history-desc">' + esc(item.description) + '</div>' +
      '</div>' +
      '<button class="restore-btn" title="되돌리기" data-i="' + i + '">' +
        '<img src="icon-restore.svg" width="32" height="32" alt="되돌리기" />' +
      '</button>';
    historyList.appendChild(div);
    div.querySelector('.restore-btn').addEventListener('click', () => restoreItem(i));
  });
}

// 되돌리기
async function restoreItem(index) {
  const item = history[index];
  if (!item) return;
  if (!item.changeId) {
    alert('되돌리기 정보가 없습니다.');
    return;
  }
  const btn = historyList.querySelectorAll('.restore-btn')[index];
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('http://127.0.0.1:3333/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeId: item.changeId }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) { history.splice(index, 1); renderHistory(); }
    else { if (btn) btn.disabled = false; }
  } catch { if (btn) btn.disabled = false; }
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
loadSavedPath();
checkServer();
renderHistory();