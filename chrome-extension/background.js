/**
 * THIS Extension - Background Service Worker
 * 향후 확장 기능 (VSCode 연동, 서버 통신 등)을 위한 백그라운드
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[THIS] Extension installed');
});

// content.js 로부터의 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') {
    sendResponse({ status: 'ok' });
  }
  return true;
});
