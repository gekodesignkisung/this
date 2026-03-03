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
const claude = apiKey ? new Anthropic({ apiKey }) : null;

// ── Health Check ──────────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    projectRoot: PROJECT_ROOT,
    claudeReady: !!claude,
  });
});

// ── Edit Request ──────────────────────────────────────
app.post('/request', async (req, res) => {
  const { selector, message, url, elementInfo } = req.body;

  console.log('\n' + '═'.repeat(60));
  console.log(`[THIS] 선택: ${selector}`);
  console.log(`[THIS] 요청: "${message}"`);
  console.log(`[THIS] URL:  ${url}`);

  if (!claude) {
    return res.status(500).json({ success: false, error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.' });
  }

  try {
    // 1. 관련 소스 파일 검색
    const files = findRelevantFiles(selector, PROJECT_ROOT);
    console.log(`[THIS] 관련 파일 ${files.length}개:`, files.map(f => f.path).join(', '));

    // 2. Claude API로 수정 내용 결정
    const result = await askClaude({ selector, message, url, files, elementInfo });
    console.log(`[THIS] Claude: ${result.description}`);

    // 3. 파일 수정 적용
    if (result.file && result.changes?.length > 0) {
      applyChanges(result.file, result.changes, PROJECT_ROOT);
      console.log(`[THIS] ✓ 수정 완료: ${result.file}`);
    } else {
      console.log('[THIS] 수정할 파일을 찾지 못함');
    }

    res.json({
      success: true,
      method: 'auto',
      description: result.description,
      file: result.file,
    });

  } catch (err) {
    console.error('[THIS] 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Find Relevant Files ───────────────────────────────
function findRelevantFiles(selector, root) {
  const EXTS = new Set(['.css', '.scss', '.sass', '.tsx', '.jsx', '.vue', '.js', '.ts']);
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
  "description": "변경 내용 한 줄 요약 (한국어)",
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
function applyChanges(relPath, changes, root) {
  const fullPath = path.join(root, relPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`파일 없음: ${fullPath}`);
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let modified = false;

  for (const { old: oldCode, new: newCode } of changes) {
    if (content.includes(oldCode)) {
      content = content.split(oldCode).join(newCode); // 모든 occurrence 교체
      modified = true;
      console.log(`  교체: "${oldCode.trim()}" → "${newCode.trim()}"`);
    } else {
      console.warn(`  [경고] 찾을 수 없음: "${oldCode.trim()}"`);
    }
  }

  if (modified) {
    fs.writeFileSync(fullPath, content, 'utf8');
    return fullPath;
  }

  return null;
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
