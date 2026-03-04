/**
 * THIS - Extension Popup
 * 패널 열기 버튼 → 현재 탭에 오른쪽 패널 토글
 * content script가 없으면 직접 주입 후 재시도
 */

const panelBtn    = document.getElementById('panel-btn');
const statusEl    = document.getElementById('status');
const serverDot   = document.getElementById('server-dot');
const serverLabel = document.getElementById('server-label');

// ── 서버 상태 확인 ────────────────────────────────
async function checkServer() {
  try {
    const res = await fetch('http://127.0.0.1:3333/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      serverDot.className     = 'dot online';
      serverLabel.textContent = data.claudeReady ? '서버 연결됨 · 자동 수정' : '서버 연결됨 · 클립보드';
    } else { throw new Error(); }
  } catch {
    serverDot.className     = 'dot offline';
    serverLabel.textContent = '서버 꺼짐 · 클립보드 모드';
  }
}

// ── 패널 열기 ─────────────────────────────────────
panelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { setStatus('탭을 찾을 수 없습니다', ''); return; }

  const ok = await trySendMessage(tab.id);
  if (ok) {
    window.close();
  } else {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      const ok2 = await trySendMessage(tab.id);
      if (ok2) { window.close(); }
      else { setStatus('페이지를 새로고침 후 다시 시도하세요', ''); }
    } catch {
      setStatus('이 페이지에서는 사용할 수 없습니다', '');
    }
  }
});

// ── 팝업 열릴 때 패널 상태 동기화 ─────────────────
async function syncPanelState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PANEL_STATE' });
    if (res?.visible) {
      panelBtn.textContent = '패널 닫기';
      panelBtn.classList.add('active');
    }
  } catch { /* content script 미실행 */ }
}

async function trySendMessage(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' });
    return res?.ok === true;
  } catch { return false; }
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className   = 'status ' + cls;
}

// ── Init ──────────────────────────────────────────
checkServer();
syncPanelState();
