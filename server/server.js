/**
 * THIS Server
 *
 * 크롬 익스텐션 → 이 서버 → Claude API → 소스 파일 자동 수정 → 핫리로드
 *
 * 설정: .env 파일에 아래 변수 설정
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   PROJECT_ROOT=D:\AI code\ck       ← 수정할 프로젝트 루트
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3333;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ── Config ────────────────────────────────────────────
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, '..'); // server/ 의 부모 폴더

const apiKey = process.env.ANTHROPIC_API_KEY;
let claude = apiKey ? new Anthropic({ apiKey }) : null;

// 변경 이력 (되돌리기용) - changeId → { file, backupChanges }
const changeLog = new Map();
let changeCounter = 0;
function newChangeId() { return `c${Date.now()}_${++changeCounter}`; }

// 중복 요청 방지 - 동일 요청 35초 내 재전송 무시 (API 타임아웃 30초 + 여유)
const recentRequests = new Map();
function isDuplicate(key) {
  const now = Date.now();
  if (recentRequests.has(key) && now - recentRequests.get(key) < 35000) return true;
  recentRequests.set(key, now);
  // 오래된 항목 정리
  for (const [k, t] of recentRequests) if (now - t > 60000) recentRequests.delete(k);
  return false;
}

// ── Config ──────────────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    projectRoot: global.PROJECT_ROOT || PROJECT_ROOT,
    claudeReady: !!claude,
  });
});

app.post('/config', (req, res) => {
  const { projectRoot, apiKey: newApiKey } = req.body;

  if (newApiKey !== undefined) {
    if (!newApiKey || typeof newApiKey !== 'string') {
      return res.status(400).json({ success: false, error: '유효한 API 키가 아닙니다.' });
    }
    try {
      claude = new Anthropic({ apiKey: newApiKey });
      console.log('[THIS] API 키 업데이트됨');
    } catch (e) {
      return res.status(400).json({ success: false, error: 'API 키 초기화 실패: ' + e.message });
    }
  }

  if (projectRoot !== undefined) {
    if (!projectRoot || typeof projectRoot !== 'string') {
      return res.status(400).json({ success: false, error: '유효한 경로가 아닙니다.' });
    }
    const resolved = path.resolve(projectRoot);
    if (!fs.existsSync(resolved)) {
      return res.status(400).json({ success: false, error: '경로가 존재하지 않습니다: ' + resolved });
    }
    global.PROJECT_ROOT = resolved;
    console.log('[THIS] 프로젝트 경로 변경: ' + resolved);
  }

  res.json({
    success: true,
    projectRoot: global.PROJECT_ROOT || PROJECT_ROOT,
    claudeReady: !!claude,
  });
});

// ── Edit Request ──────────────────────────────────────
app.post('/request', async (req, res) => {
  const { selector, message, url, elementInfo } = req.body;

  // 중복 요청 차단
  const dedupKey = `${selector}::${message}::${url}`;
  if (isDuplicate(dedupKey)) {
    console.log(`[THIS] 중복 요청 무시: "${message}" (${selector})`);
    return res.status(429).json({ success: false, error: '중복 요청이 무시되었습니다.' });
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`[THIS] 선택: ${selector}`);
  console.log(`[THIS] 요청: "${message}"`);
  console.log(`[THIS] URL:  ${url}`);

  if (!claude) {
    return res.status(500).json({ success: false, error: 'API 키가 설정되지 않았습니다. 익스텐션 설정에서 Anthropic API 키를 입력하세요.' });
  }

  try {
    // 1. 관련 소스 파일 검색
    const files = findRelevantFiles(selector, global.PROJECT_ROOT || PROJECT_ROOT);
    console.log(`[THIS] 관련 파일 ${files.length}개:`, files.map(f => f.path).join(', '));

    // 2. Claude API로 수정 내용 결정
    const result = await askClaude({ selector, message, url, files, elementInfo });
    console.log(`[THIS] Claude: ${result.description}`);

    // 3. 파일 수정 적용
    if (result.file && result.changes?.length > 0) {
      const { modified, backupChanges } = applyChanges(result.file, result.changes, global.PROJECT_ROOT || PROJECT_ROOT);
      if (modified) {
        console.log(`[THIS] ✓ 수정 완료: ${result.file}`);
        // 되돌리기용 이력 저장
        const changeId = newChangeId();
        changeLog.set(changeId, { file: result.file, backupChanges });
        return res.json({
          success: true,
          method: 'auto',
          description: result.description,
          file: result.file,
          changeId,
        });
      } else {
        console.log(`[THIS] ✗ 매칭 실패 (공백/내용 불일치): ${result.file}`);
        return res.status(422).json({
          success: false,
          error: `파일에서 수정 대상 코드를 찾을 수 없습니다: ${result.file}`,
        });
      }
    } else {
      console.log('[THIS] 수정할 파일을 찾지 못함');
      return res.status(422).json({ success: false, error: '수정할 파일을 찾지 못했습니다.' });
    }

  } catch (err) {
    console.error('[THIS] 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Restore ──────────────────────────────────────────
app.post('/restore', (req, res) => {
  const { changeId } = req.body;
  if (!changeId || !changeLog.has(changeId)) {
    return res.status(404).json({ success: false, error: '되돌릴 수 없는 항목입니다.' });
  }
  const { file, backupChanges } = changeLog.get(changeId);
  console.log(`\n[THIS] 되돌리기: ${file} (${changeId})`);
  try {
    const { modified } = applyChanges(file, backupChanges, global.PROJECT_ROOT || PROJECT_ROOT);
    if (modified) {
      changeLog.delete(changeId);
      console.log(`[THIS] ✓ 되돌리기 완료: ${file}`);
      res.json({ success: true, file });
    } else {
      res.status(422).json({ success: false, error: '되돌릴 코드를 파일에서 찾을 수 없습니다.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Find Relevant Files ───────────────────────────────
function findRelevantFiles(selector, root) {
  const EXTS = new Set(['.html', '.css', '.scss', '.sass', '.tsx', '.jsx', '.vue', '.js', '.ts']);
  const IGNORE = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'coverage', '.cache', 'out']);

  // 선택자에서 검색 키워드 추출
  // 예: "button.btn-primary#submit" → ["btn-primary", "submit", "button"]
  const keywords = selector
    .replace(/[.#\[\]()>~+*:]/g, ' ')
    .split(/\s+/)
    .filter(k => k.length > 1);

  const results = [];

  function scan(dir, depth = 0) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (IGNORE.has(entry)) continue;
      const full = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        scan(full, depth + 1);
      } else if (EXTS.has(path.extname(entry).toLowerCase())) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          let score = 0;
          for (const kw of keywords) {
            if (content.includes(kw)) score++;
          }
          if (score > 0) {
            results.push({ path: path.relative(root, full), content, score });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  scan(root);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ path: p, content }) => ({ path: p, content }));
}

// ── Ask Claude ────────────────────────────────────────
async function askClaude({ selector, message, url, files, elementInfo }) {
  const filesSection = files.length > 0
    ? files.map(f =>
        `### 📄 ${f.path}\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``
      ).join('\n\n')
    : '(관련 파일을 찾지 못했습니다)';

  const styleInfo = elementInfo
    ? `font-size: ${elementInfo.fontSize}, color: ${elementInfo.color}, display: ${elementInfo.display}`
    : '(정보 없음)';

  const prompt = `웹 개발 중인 프로젝트에서 DOM 요소를 수정하는 작업입니다.

## 선택된 요소
- CSS 선택자: \`${selector}\`
- 현재 스타일: ${styleInfo}
- 페이지 URL: ${url}

## 사용자 요청
"${message}"

## 관련 소스 파일
${filesSection}

## 지시사항
위 파일들 중에서 선택된 요소의 스타일/코드를 수정할 수 있는 파일을 찾아 변경사항을 제안해주세요.

반드시 아래 JSON 형식으로만 응답하세요 (설명 텍스트 없이 JSON만):
{
  "description": "변경 내용 한 줄 요약 (한국어, 주어 생략. 예: 폰트 크기 40px로 변경, 배경색 파란색으로 수정)",
  "file": "수정할 파일 경로 (찾지 못하면 null)",
  "changes": [
    {
      "old": "기존 코드 (파일에서 정확히 찾을 수 있는 문자열)",
      "new": "새 코드"
    }
  ]
}`;

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();

  // JSON 파싱 (마크다운 코드블록 안에 있을 수도 있음)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude 응답 파싱 실패: ${text.slice(0, 200)}`);

  return JSON.parse(jsonMatch[0]);
}

// ── Apply Changes ─────────────────────────────────────
function normalizeWS(str) {
  // 각 줄의 앞뒤 공백 제거 후 재결합 (들여쓰기 차이 무시)
  return str.split('\n').map(l => l.trim()).join('\n').trim();
}

function flexibleReplace(content, oldCode, newCode) {
  const oldNorm = oldCode.replace(/\r\n/g, '\n');
  const newNorm = newCode.replace(/\r\n/g, '\n');

  // 1단계: 정확히 일치
  if (content.includes(oldNorm)) {
    return content.split(oldNorm).join(newNorm);
  }

  // 2단계: 공백 정규화 후 일치 (들여쓰기/공백 차이 허용)
  const lines = content.split('\n');
  const oldLines = oldNorm.split('\n');
  const oldWSNorm = oldLines.map(l => l.trim());
  const oldLen = oldLines.length;

  for (let i = 0; i <= lines.length - oldLen; i++) {
    const slice = lines.slice(i, i + oldLen).map(l => l.trim());
    if (slice.join('\n') === oldWSNorm.join('\n')) {
      // 기존 첫 줄의 들여쓰기를 기준으로 새 코드 들여쓰기 맞추기
      const baseIndent = lines[i].match(/^(\s*)/)[1];
      const newLines = newNorm.split('\n').map((l, idx) => {
        if (idx === 0) return baseIndent + l.trim();
        // old의 상대 들여쓰기 계산
        const oldIndent = oldLines[idx]?.match(/^(\s*)/)?.[1] ?? '';
        const relativeIndent = oldIndent.length > oldLines[0].match(/^(\s*)/)[1].length
          ? ' '.repeat(oldIndent.length - oldLines[0].match(/^(\s*)/)[1].length)
          : '';
        return baseIndent + relativeIndent + l.trim();
      });
      const result = [...lines];
      result.splice(i, oldLen, ...newLines);
      return result.join('\n');
    }
  }

  return null; // 매칭 실패
}

function applyChanges(relPath, changes, root) {
  const fullPath = path.join(root, relPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`파일 없음: ${fullPath}`);
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  // CRLF → LF 정규화 (Windows 파일 대응)
  const isCRLF = content.includes('\r\n');
  content = content.replace(/\r\n/g, '\n');
  let modified = false;

  const backupChanges = [];

  for (const { old: oldCode, new: newCode } of changes) {
    const replaced = flexibleReplace(content, oldCode, newCode);
    if (replaced !== null) {
      const oldNorm = oldCode.replace(/\r\n/g, '\n');
      const newNorm = newCode.replace(/\r\n/g, '\n');
      backupChanges.push({ old: newNorm, new: oldNorm });
      content = replaced;
      modified = true;
      console.log(`  교체: "${oldCode.trim().slice(0, 60)}" → "${newCode.trim().slice(0, 60)}"`);
    } else {
      console.warn(`  [경고] 찾을 수 없음: "${oldCode.trim().slice(0, 100)}"`);
    }
  }

  if (modified) {
    // 원래 CRLF였으면 복원
    const finalContent = isCRLF ? content.replace(/\n/g, '\r\n') : content;
    fs.writeFileSync(fullPath, finalContent, 'utf8');
    return { modified: fullPath, backupChanges };
  }

  return { modified: null, backupChanges };
}

// ── Start ─────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         THIS Server  v2.0            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  포트:         http://127.0.0.1:${PORT}`);
  console.log(`  프로젝트:     ${PROJECT_ROOT}`);
  console.log(`  Claude API:   ${claude ? '✓ 연결됨 (자동 수정 모드)' : '✗ 미설정 (클립보드 모드)'}`);
  console.log('');
  if (!claude) {
    console.log('  ⚠ .env 파일에 ANTHROPIC_API_KEY 를 설정하면');
    console.log('    소스 파일을 자동으로 수정합니다.');
    console.log('');
  }
});
