/**
 * THIS Extension - Content Script
 * popup.js로부터 ACTIVATE_PICKER 메시지를 받아 페이지에서 요소 선택 모드를 실행합니다
 */
(function () {
  'use strict';

  if (window.__thisExtLoaded) return;
  window.__thisExtLoaded = true;

  // ── State ────────────────────────────────────────────
  let isPickerActive = false;
  let hoveredEl = null;
  let selectedEl = null;
  let popupEl = null;
  let bannerEl = null;

  // ── Message Listener (popup → content) ───────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'ACTIVATE_PICKER') {
      activatePicker();
      sendResponse({ picking: true });
    }
    return true;
  });

  // ── Picker Activate ───────────────────────────────────
  function activatePicker() {
    if (isPickerActive) return;
    isPickerActive = true;

    showBanner();
    document.addEventListener('mouseover', onHover);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKeyDown);
  }

  function deactivatePicker() {
    if (!isPickerActive) return;
    isPickerActive = false;

    hideBanner();
    removeHighlights();
    document.removeEventListener('mouseover', onHover);
    document.removeEventListener('mouseout', onMouseOut);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKeyDown);

    chrome.runtime.sendMessage({ type: 'PICK_CANCELLED' });
  }

  // ── Banner ────────────────────────────────────────────
  function showBanner() {
    if (bannerEl) return;
    bannerEl = document.createElement('div');
    bannerEl.id = 'this-ext-banner';
    bannerEl.innerHTML = `<span>▷ 수정할 요소를 클릭하세요</span><kbd>ESC</kbd><span>취소</span>`;
    document.body.appendChild(bannerEl);
  }

  function hideBanner() {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  // ── Highlight ─────────────────────────────────────────
  function onHover(e) {
    if (isOurElement(e.target)) return;
    if (hoveredEl) hoveredEl.classList.remove('this-ext-hover');
    hoveredEl = e.target;
    hoveredEl.classList.add('this-ext-hover');
  }

  function onMouseOut(_e) {
    if (hoveredEl) {
      hoveredEl.classList.remove('this-ext-hover');
      hoveredEl = null;
    }
  }

  function removeHighlights() {
    document.querySelectorAll('.this-ext-hover').forEach(el => el.classList.remove('this-ext-hover'));
    document.querySelectorAll('.this-ext-selected').forEach(el => el.classList.remove('this-ext-selected'));
  }

  // ── Pick Element ──────────────────────────────────────
  function onPick(e) {
    if (isOurElement(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    removeHighlights();
    selectedEl = e.target;
    selectedEl.classList.add('this-ext-selected');

    deactivatePicker();
    showPopup(selectedEl);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (popupEl) closePopup();
      else deactivatePicker();
    }
  }

  // ── Element Info ──────────────────────────────────────
  function getElementInfo(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = [...el.classList]
      .filter(c => !c.startsWith('this-ext-'))
      .map(c => `.${c}`)
      .join('');

    const selector = `${tag}${id}${classes}` || tag;
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
    const cs = window.getComputedStyle(el);

    return {
      selector,
      tag,
      text,
      fontSize: cs.fontSize,
      color: cs.color,
      bgColor: cs.backgroundColor,
      display: cs.display,
    };
  }

  // ── Popup ─────────────────────────────────────────────
  function showPopup(el) {
    closePopup();

    const info = getElementInfo(el);
    const rect = el.getBoundingClientRect();

    popupEl = document.createElement('div');
    popupEl.id = 'this-ext-popup';
    popupEl.innerHTML = `
      <div class="this-popup-header">
        <span class="this-popup-tag" title="${escapeHtml(info.selector)}">${escapeHtml(info.selector)}</span>
        <button class="this-popup-close">✕</button>
      </div>
      <div class="this-popup-body">
        <textarea
          class="this-popup-input"
          placeholder="수정 요청을 입력하세요&#10;예: 폰트크기 40px로  /  색상 파란색으로"
          rows="3"
        ></textarea>
      </div>
      <div class="this-popup-footer">
        <span class="this-popup-hint">Shift+Enter 줄바꿈</span>
        <button class="this-popup-send">전달하기 ↵</button>
      </div>
    `;

    document.body.appendChild(popupEl);
    positionPopup(popupEl, rect);

    popupEl.querySelector('.this-popup-close').addEventListener('click', closePopup);

    const textarea = popupEl.querySelector('.this-popup-input');
    const sendBtn = popupEl.querySelector('.this-popup-send');

    sendBtn.addEventListener('click', () => handleSend(info, textarea));
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend(info, textarea);
      }
    });

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, true);
    }, 100);

    textarea.focus();
  }

  function onOutsideClick(e) {
    if (popupEl && !popupEl.contains(e.target)) {
      closePopup();
    }
  }

  function positionPopup(popup, rect) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const POPUP_W = 300;
    const POPUP_H = 185;
    const GAP = 10;

    let left = rect.left + scrollX;
    let top = rect.bottom + scrollY + GAP;
    let arrowClass = 'this-arrow-up';

    if (rect.bottom + POPUP_H + GAP > vh) {
      top = rect.top + scrollY - POPUP_H - GAP;
      arrowClass = 'this-arrow-down';
    }

    if (left + POPUP_W > vw - 8) {
      left = Math.max(8, vw - POPUP_W - 8);
    }

    popup.style.left = `${Math.max(8, left)}px`;
    popup.style.top = `${Math.max(8, top)}px`;
    popup.classList.add(arrowClass);
  }

  // ── Send ──────────────────────────────────────────────
  async function handleSend(info, textarea) {
    const message = textarea.value.trim();
    if (!message) {
      textarea.style.borderColor = '#ef4444';
      textarea.focus();
      return;
    }

    const sendBtn = popupEl.querySelector('.this-popup-send');
    sendBtn.disabled = true;
    sendBtn.textContent = '전송 중...';

    try {
      const result = await sendToServer(info, message);
      if (result.success === false) {
        showError(result.error || '수정에 실패했습니다.');
      } else {
        showSuccess(result);
        chrome.runtime.sendMessage({ type: 'PICK_DONE', selector: info.selector });
      }
    } catch (err) {
      showError('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
    }
  }

  async function sendToServer(info, message) {
    const res = await fetch('http://127.0.0.1:3333/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: info.selector,
        message,
        url: window.location.href,
        elementInfo: {
          fontSize: info.fontSize,
          color: info.color,
          display: info.display,
          text: info.text,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    return await res.json();
  }

  // ── Success / Close ───────────────────────────────────
  function showSuccess(result) {
    if (!popupEl) return;
    document.removeEventListener('click', onOutsideClick, true);

    const sub = result.file
      ? `<small style="opacity:.6">${result.file}</small>`
      : '';

    popupEl.innerHTML = `
      <div class="this-popup-success">
        <span class="this-success-icon">✅</span>
        <span class="this-success-title">${result.description || '수정 완료!'}</span>
        <span class="this-success-sub">${sub}</span>
      </div>
    `;
    setTimeout(closePopup, 3500);
  }

  function showError(msg) {
    if (!popupEl) return;
    document.removeEventListener('click', onOutsideClick, true);
    popupEl.innerHTML = `
      <div class="this-popup-success">
        <span class="this-success-icon">❌</span>
        <span class="this-success-title">전달 실패</span>
        <span class="this-success-sub" style="color:#f87171">${msg}</span>
      </div>
    `;
    setTimeout(closePopup, 5000);
  }

  function closePopup() {
    document.removeEventListener('click', onOutsideClick, true);
    if (popupEl) { popupEl.remove(); popupEl = null; }
    if (selectedEl) { selectedEl.classList.remove('this-ext-selected'); selectedEl = null; }
  }

  // ── Utils ─────────────────────────────────────────────
  function isOurElement(el) {
    if (!el) return false;
    return (
      el.id === 'this-ext-popup' ||
      el.id === 'this-ext-banner' ||
      el.closest?.('#this-ext-popup') ||
      el.closest?.('#this-ext-banner')
    );
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
