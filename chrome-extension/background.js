/**
 * THIS Extension - Background Service Worker
 * 아이콘 클릭 → Side Panel 열기
 */

chrome.runtime.onInstalled.addListener(() => {
  // 모든 탭에서 side panel 활성화
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// content.js 로부터의 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ status: 'ok' });
  }
  return true;
});

