/**
 * THIS - Extension Popup
 * THIS 버튼 클릭 → 현재 탭의 content script에 피커 활성화 메시지 전송
 * content script가 없으면 직접 주입 후 재시도
 */

const pickBtn  = document.getElementById('pick-btn');
const statusEl = document.getElementById('status');
const serverDot   = document.getElementById('server-dot');
const serverLabel = document.getElementById('server-label');

// ── 서버 상태 확인 ────────────────────────────────
async function checkServer() {
  try {
    const res = await fetch('http://127.0.0.1:3333/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json();
      serverDot.className = 'dot online';
      serverLabel.textContent = data.claudeReady
        ? '서버 연결됨 · 자동 수정 모드'
        : '서버 연결됨 · 클립보드 모드';
    } else {
      throw new Error();
    }
  } catch {
    serverDot.className = 'dot offline';
    serverLabel.textContent = '서버 꺼짐 · 클립보드 모드';
  }
}

// ── THIS 버튼 클릭 ────────────────────────────────
pickBtn.addEventListener('click', async () => {
  setStatus('연결 중...', '');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('탭을 찾을 수 없습니다', '');
    return;
  }

  // 1차 시도: content script에 메시지 전송
  const ok = await trySendMessage(tab.id);

  if (ok) {
    // 성공: 팝업 닫고 피커 모드 시작
    window.close();
  } else {
    // 실패: content script 직접 주입 후 재시도
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css'],
      });

      const ok2 = await trySendMessage(tab.id);
      if (ok2) {
        window.close();
      } else {
        setStatus('페이지를 새로고침 후 다시 시도하세요', '');
      }
    } catch (err) {
      setStatus('이 페이지에서는 사용할 수 없습니다', '');
      console.error('[THIS]', err);
    }
  }
});

async function trySendMessage(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'ACTIVATE_PICKER' });
    return res?.picking === true;
  } catch {
    return false;
  }
}

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = `status ${className}`;
}

// ── Init ──────────────────────────────────────────
checkServer();
