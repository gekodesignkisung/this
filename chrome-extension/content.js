/**
 * THIS Extension - Content Script
 * - ACTIVATE_PICKER / DEACTIVATE_PICKER : sidepanel.js 에서 수신
 * - 요소 클릭 : 미니 팝업(클릭 위치) + ELEMENT_PICKED -> sidepanel
 */
(function () {
  'use strict';

  if (window.__thisExtLoaded) return;
  window.__thisExtLoaded = true;

  let isPickerActive = false;
  let hoveredEl      = null;
  let selectedEl     = null;
  let popupEl        = null;

  //  Message Listener 
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'ACTIVATE_PICKER') {
        activatePicker();
        sendResponse({ ok: true });
      } else if (msg.type === 'DEACTIVATE_PICKER') {
        deactivatePicker();
        sendResponse({ ok: true });
      }
      return true;
    });
  } catch (_) { /* context invalidated */ }

  //  Picker 
  function activatePicker() {
    if (isPickerActive) return;
    isPickerActive = true;
    document.addEventListener('mouseover', onHover);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKeyDown);
  }

  function deactivatePicker() {
    if (!isPickerActive) return;
    isPickerActive = false;
    removeHighlights();
    document.removeEventListener('mouseover', onHover);
    document.removeEventListener('mouseout', onMouseOut);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKeyDown);
  }

  //  Hover Highlight 
  function onHover(e) {
    if (isOurElement(e.target)) return;
    if (hoveredEl) hoveredEl.classList.remove('this-ext-hover');
    hoveredEl = e.target;
    hoveredEl.classList.add('this-ext-hover');
  }

  function onMouseOut() {
    if (hoveredEl) { hoveredEl.classList.remove('this-ext-hover'); hoveredEl = null; }
  }

  function removeHighlights() {
    document.querySelectorAll('.this-ext-hover').forEach(el => el.classList.remove('this-ext-hover'));
    document.querySelectorAll('.this-ext-selected').forEach(el => el.classList.remove('this-ext-selected'));
  }

  //  Pick Element 
  function onPick(e) {
    if (isOurElement(e.target)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

    isPickerActive = false;
    document.removeEventListener('mouseover', onHover);
    document.removeEventListener('mouseout', onMouseOut);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKeyDown);

    removeHighlights();
    selectedEl = e.target;
    selectedEl.classList.add('this-ext-selected');

    const info = getElementInfo(selectedEl);

    // sidepanel 에 요소 정보 전달
    try { chrome.runtime.sendMessage({ type: 'ELEMENT_PICKED', info }); } catch (_) {}

    // 클릭 위치에 미니 팝업 표시 (기존 동일)
    showPopup(selectedEl, info);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (popupEl) closePopup(true);
      else {
        deactivatePicker();
        try { chrome.runtime.sendMessage({ type: 'PICK_CANCELLED' }); } catch (_) {}
      }
    }
  }

  //  Mini Popup (클릭 위치) 
  function showPopup(el, info) {
    closePopup(false);
    const rect = el.getBoundingClientRect();

    popupEl = document.createElement('div');
    popupEl.id = 'this-ext-popup';
    popupEl.innerHTML =
      '<div class="tpp-header">' +
        '<span class="tpp-tag" title="' + escapeHtml(info.selector) + '">' + escapeHtml(info.selector) + '</span>' +
        '<button class="tpp-close">\u2715</button>' +
      '</div>' +
      '<div class="tpp-body">' +
        '<textarea class="tpp-input" placeholder="\uc218\uc815 \uc694\uccad\uc744 \uc785\ub825\ud558\uc138\uc694&#10;\uc608: \ud3f0\ud2b8\ud06c\uae30 40px\ub85c  /  \uc0c9\uc0c1 \ud30c\ub780\uc0c9\uc73c\ub85c" rows="3"></textarea>' +
      '</div>' +
      '<div class="tpp-footer">' +
        '<span class="tpp-hint">Shift+Enter \uc904\ubc14\uae40</span>' +
        '<button class="tpp-send">\uc804\ub2ec\ud558\uae30</button>' +
      '</div>';

    document.body.appendChild(popupEl);
    positionPopup(popupEl, rect);

    popupEl.querySelector('.tpp-close').addEventListener('click', () => closePopup(true));
    const textarea = popupEl.querySelector('.tpp-input');
    const sendBtn  = popupEl.querySelector('.tpp-send');
    sendBtn.addEventListener('click', () => handleSend(info, textarea));
    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); handleSend(info, textarea); }
    });
    setTimeout(() => document.addEventListener('click', onOutsideClick, true), 100);
    textarea.focus();
  }

  function positionPopup(popup, rect) {
    var POPUP_W = 300, POPUP_H = 190, GAP = 10;
    var scrollX = window.scrollX, scrollY = window.scrollY;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    var left = rect.left + scrollX;
    var top  = rect.bottom + scrollY + GAP;
    var arrowCls = 'arrow-up';

    if (rect.bottom + POPUP_H + GAP > vh) {
      top = rect.top + scrollY - POPUP_H - GAP;
      arrowCls = 'arrow-down';
    }
    if (left + POPUP_W > vw - 8) left = Math.max(8, vw - POPUP_W - 8);

    popup.style.left = Math.max(8, left) + 'px';
    popup.style.top  = Math.max(8, top) + 'px';
    popup.classList.add(arrowCls);
  }

  function onOutsideClick(e) {
    if (popupEl && !popupEl.contains(e.target) && !isOurElement(e.target)) closePopup(true);
  }

  function closePopup(resumePicker) {
    document.removeEventListener('click', onOutsideClick, true);
    if (popupEl) { popupEl.remove(); popupEl = null; }
    if (selectedEl) { selectedEl.classList.remove('this-ext-selected'); selectedEl = null; }
    if (resumePicker) activatePicker();
  }

  //  Send to Server 
  async function handleSend(info, textarea) {
    var message = textarea.value.trim();
    if (!message) { textarea.style.borderColor = '#ef4444'; textarea.focus(); return; }

    var sendBtn = popupEl && popupEl.querySelector('.tpp-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '\uc804\uc1a1 \uc911...'; }

    try {
      var result = await sendToServer(info, message);
      if (result.success === false) {
        showPopupResult(false, result.error || '\uc218\uc815\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.');
      } else {
        showPopupResult(true, result.description || '\uc218\uc815 \uc644\ub8cc!', result.file);
        try { chrome.runtime.sendMessage({ type: 'PICK_DONE', selector: info.selector, description: result.description || '수정 완료', file: result.file || null, changeId: result.changeId || null }); } catch (_) {}
      }
    } catch (_) {
      showPopupResult(false, '\uc11c\ubc84\uc5d0 \uc5f0\uacb0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
    }
  }

  async function sendToServer(info, message) {
    var res = await fetch('http://127.0.0.1:3333/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: info.selector, message: message, url: window.location.href,
        elementInfo: { fontSize: info.fontSize, color: info.color, display: info.display, text: info.text },
      }),
      signal: AbortSignal.timeout(30000),
    });
    return await res.json();
  }

  function showPopupResult(success, msg, file) {
    if (!popupEl) return;
    document.removeEventListener('click', onOutsideClick, true);
    var sub = file ? '<small style="opacity:.6">' + file + '</small>' : '';
    popupEl.innerHTML =
      '<div class="tpp-result">' +
        '<span class="tpp-result-title">' + msg + '</span>' +
        sub +
      '</div>';
    setTimeout(function() { closePopup(true); }, success ? 1800 : 4000);
  }

  //  Element Info 
  function getElementInfo(el) {
    var tag = el.tagName.toLowerCase();
    var id  = el.id ? '#' + el.id : '';
    var cls = Array.from(el.classList)
      .filter(function(c) { return !c.startsWith('this-ext-'); })
      .map(function(c) { return '.' + c; }).join('');
    var selector = tag + id + cls || tag;
    var text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
    var cs = window.getComputedStyle(el);
    return { selector: selector, tag: tag, text: text, url: window.location.href,
             fontSize: cs.fontSize, color: cs.color, bgColor: cs.backgroundColor, display: cs.display };
  }

  //  Utils 
  function isOurElement(el) {
    if (!el) return false;
    return !!(el.closest && el.closest('#this-ext-popup'));
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();