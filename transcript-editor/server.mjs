// 녹취록 편집기 — 로컬 서버 (맥북에서 실행)
// - 편집기 화면(index.html)을 127.0.0.1 에서만 제공합니다.
// - API 키는 이 서버에만 있고 브라우저 페이지로는 전달되지 않습니다.
// - Claude 호출은 공식 SDK(@anthropic-ai/sdk)로 합니다.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.TE_HOME || path.join(os.homedir(), '.transcript-editor');
const CFG = path.join(HOME, 'config.json');
const PORT0 = Number(process.env.PORT) || 4173;

/* ---------- 모델 ---------- */
const MODELS = {
  'claude-opus-5-5':   { label: 'Opus 5.5 (권장, 최고 품질)', inUsd: 4,   outUsd: 20,  fallback: true },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5 (빠르고 저렴)',   inUsd: 2,   outUsd: 10,  fallback: true },
  'claude-haiku-5-5':  { label: 'Haiku 5.5 (가장 저렴)',      inUsd: 0.1, outUsd: 0.5, fallback: false },
};
const EFFORTS = ['low', 'medium', 'high'];

/* ---------- 키 저장 ---------- */
function readCfg() { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return {}; } }
function writeCfg(c) {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CFG, JSON.stringify(c), { mode: 0o600 });
  try { fs.chmodSync(CFG, 0o600); } catch {}
}
function keySource() {
  if (process.env.ANTHROPIC_API_KEY) return 'env';
  if (readCfg().apiKey) return 'stored';
  if (process.env.ANTHROPIC_AUTH_TOKEN) return 'env-token';
  return 'none';
}
function getClient() {
  const stored = readCfg().apiKey;
  // 환경변수 키가 있으면 SDK 기본 동작(인자 없이 생성)을 그대로 따릅니다.
  if (!process.env.ANTHROPIC_API_KEY && stored) return new Anthropic({ apiKey: stored, maxRetries: 2 });
  return new Anthropic({ maxRetries: 2 });
}

/* ---------- 공통 ---------- */
class UserError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

function modelOpts(body) {
  const model = MODELS[body.model] ? body.model : 'claude-opus-5-5';
  const effort = EFFORTS.includes(body.effort) ? body.effort : 'medium';
  return { model, effort, info: MODELS[model] };
}

function numbered(utts) {
  return utts.map((u, i) => `[${i + 1}] ${u.speaker ? u.speaker + ': ' : ''}${u.text}`).join('\n');
}
function clip(s, n) { return String(s ?? '').slice(0, n); }

const BASE_RULES = `당신은 한국어 녹취록 정리 전문가입니다. 입력은 통화·회의를 음성 인식으로 받아 적은 발언 목록이며 각 줄은 "[번호] 화자: 내용" 형식입니다.
지켜야 할 원칙:
1. 원문에 없는 사실, 수치, 날짜, 인명, 기관명을 만들지 않습니다. 확실하지 않으면 "불명확"이라고 적습니다.
2. 발언자의 주장과 객관적 사실을 구분합니다. 합의되지 않은 내용을 합의된 것처럼 쓰지 않습니다.
3. 음성 인식 오류의 교정은 문맥상 거의 확실한 경우에만 하며, 교정 사전이 주어지면 우선합니다.
4. 모든 항목에는 근거가 되는 발언 번호(evidence)를 답니다. 번호는 입력의 [번호]와 정확히 일치해야 합니다.
5. 문장은 간결한 한국어 서술체(~했다, ~이다)로 씁니다. 과장하거나 감정적 표현을 더하지 않습니다.
6. 후속 제안은 당사자 간 합의가 아닌 "제안"이며, 구체적이고 실행 가능해야 합니다.`;

/* ---------- 스키마 ---------- */
const INT_ARR = { type: 'array', items: { type: 'integer' } };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const S = { type: 'string' };

const ANALYZE_SCHEMA = obj({
  agenda: S,
  purpose: S,
  corrections: { type: 'array', items: obj({ utt: { type: 'integer' }, from: S, to: S, reason: S }) },
  topics: { type: 'array', items: obj({
    label: S,
    utts: INT_ARR,
    points: { type: 'array', items: obj({ speaker: S, text: S, evidence: INT_ARR }) },
  }) },
  summary: { type: 'array', items: obj({ text: S, evidence: INT_ARR }) },
  decisions: { type: 'array', items: obj({ text: S, speaker: S, evidence: INT_ARR }) },
  actions: { type: 'array', items: obj({ task: S, owner: S, due: S, evidence: INT_ARR }) },
  open_issues: { type: 'array', items: obj({ text: S, evidence: INT_ARR }) },
  qa: { type: 'array', items: obj({ question: S, answer: S, evidence: INT_ARR }) },
  facts: { type: 'array', items: obj({ value: S, context: S, evidence: INT_ARR }) },
  proposals: { type: 'array', items: obj({ title: S, detail: S, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, evidence: INT_ARR }) },
  warnings: { type: 'array', items: S },
});

const VERIFY_SCHEMA = obj({
  results: { type: 'array', items: obj({
    id: { type: 'integer' },
    verdict: { type: 'string', enum: ['supported', 'partial', 'unsupported'] },
    evidence: INT_ARR,
    note: S,
  }) },
});

const DRAFT_SCHEMA = obj({ subject: S, body: S });

/* ---------- Claude 호출 ---------- */
function buildParams({ model, effort, info }, { system, messages, schema, maxTokens }) {
  const p = { model, max_tokens: maxTokens, system, messages, output_config: { effort } };
  if (schema) p.output_config.format = { type: 'json_schema', schema };
  if (info.fallback) { p.betas = ['server-side-fallback-2026-07-01']; p.fallbacks = 'default'; }
  return p;
}

async function callClaude(opts, spec, { stream = false, onText, signal } = {}) {
  const client = getClient();
  const params = buildParams(opts, spec);
  const api = opts.info.fallback ? client.beta.messages : client.messages;
  let msg;
  if (stream) {
    const s = api.stream(params, { signal });
    if (onText) s.on('text', onText);
    msg = await s.finalMessage();
  } else {
    msg = await api.create(params, { signal });
  }
  if (msg.stop_reason === 'refusal') {
    throw new UserError('Claude가 안전 정책으로 이 요청을 처리하지 않았습니다. 내용을 나눠 다시 시도하거나 모델을 바꿔 보세요.', 422);
  }
  if (msg.stop_reason === 'max_tokens') {
    throw new UserError('응답이 너무 길어 잘렸습니다. 원본을 나눠서 실행하거나 모델을 바꿔 보세요.', 422);
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = msg.usage || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const outTok = u.output_tokens || 0;
  const usd = (inTok * opts.info.inUsd + outTok * opts.info.outUsd) / 1e6;
  return { text, usage: { input: inTok, output: outTok, usd: Math.round(usd * 1000) / 1000, model: msg.model || opts.model } };
}
function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new UserError('Claude 응답을 해석하지 못했습니다. 다시 시도해 주세요.', 502); }
}

/* ---------- 엔드포인트 ---------- */
function utterancesOf(body) {
  const utts = Array.isArray(body.utts) ? body.utts : [];
  if (!utts.length) throw new UserError('원본 발언이 비어 있습니다.');
  return utts.map((u) => ({ speaker: clip(u.speaker, 40), text: clip(u.text, 4000) }));
}
function metaText(m = {}) {
  return ['title', 'when', 'from', 'to', 'agenda', 'purpose']
    .filter((k) => m[k]).map((k) => `${{ title: '제목', when: '일시', from: '발신', to: '수신', agenda: '안건', purpose: '목적' }[k]}: ${clip(m[k], 300)}`).join('\n');
}

async function analyze(body, ctl) {
  const opts = modelOpts(body);
  const utts = utterancesOf(body);
  const user = [
    '다음 발언 목록을 분석해 지정된 JSON 형식으로 정리하세요.',
    '- topics: 발언 전체를 순서대로 빠짐없이, 겹치지 않게 주제 구간으로 나눕니다(utts에 해당 구간의 발언 번호를 모두 나열). 각 구간의 points는 핵심 내용을 화자별로 간결하게 정리한 항목입니다.',
    '- corrections: 음성 인식 오류를 고칠 때만 사용합니다. from은 해당 발언에 그대로 들어 있는 원문 조각이어야 합니다.',
    '- summary: 확인된 사항 요약(결정·약속·확인된 사실·미정 사항)을 3~8개로 씁니다.',
    '- decisions/actions/open_issues/qa/facts: 원문에 실제로 있는 것만 담고 없으면 빈 배열로 둡니다.',
    '- proposals: 원본에서 미해결로 남은 문제를 풀기 위한 후속 조치 제안을 우선순위와 함께 씁니다.',
    '- warnings: 음질·문맥상 불명확해 대외 인용 전에 원 녹음 확인이 필요한 구간을 적습니다.',
    '- agenda/purpose: 사용자가 이미 입력했다면 그 값을 존중하고, 비어 있으면 원본에서 추정해 한 줄로 씁니다.',
    '',
    metaText(body.meta) && `[문서 정보]\n${metaText(body.meta)}`,
    body.glossary && `[교정 사전]\n${clip(body.glossary, 3000)}`,
    `[발언 목록]\n${numbered(utts)}`,
  ].filter(Boolean).join('\n');
  const r = await callClaude(opts, {
    system: BASE_RULES, messages: [{ role: 'user', content: user }], schema: ANALYZE_SCHEMA, maxTokens: 64000,
  }, { stream: true, onText: ctl.onText, signal: ctl.signal });
  return { data: parseJson(r.text), usage: r.usage };
}

async function verify(body, ctl) {
  const opts = modelOpts(body);
  const utts = utterancesOf(body);
  const blocks = (Array.isArray(body.blocks) ? body.blocks : []).slice(0, 200).map((b) => ({ id: b.id | 0, text: clip(b.text, 1200) }));
  if (!blocks.length) throw new UserError('대조할 문장이 없습니다.');
  const user = [
    '아래 [정리문]의 각 항목이 [발언 목록]에 의해 뒷받침되는지 검증하세요.',
    '- supported: 원본이 명확히 뒷받침한다.',
    '- partial: 일부만 뒷받침하거나, 표현이 과장·축약·추정되었다.',
    '- unsupported: 원본에 근거가 없거나 원본과 모순된다.',
    '모든 항목에 대해 결과를 하나씩 돌려주고, evidence에는 근거 발언 번호를, note에는 partial/unsupported일 때만 이유를 한 문장으로 씁니다(supported이면 빈 문자열).',
    '',
    `[정리문]\n${blocks.map((b) => `(${b.id}) ${b.text}`).join('\n')}`,
    '',
    `[발언 목록]\n${numbered(utts)}`,
  ].join('\n');
  const r = await callClaude(opts, {
    system: BASE_RULES, messages: [{ role: 'user', content: user }], schema: VERIFY_SCHEMA, maxTokens: 32000,
  }, { stream: true, onText: ctl.onText, signal: ctl.signal });
  return { data: parseJson(r.text), usage: r.usage };
}

async function edit(body, ctl) {
  const opts = modelOpts(body);
  const utts = utterancesOf(body);
  const sel = clip(body.selection, 6000);
  if (!sel.trim()) throw new UserError('선택한 문장이 없습니다.');
  const instruction = clip(body.instruction, 500) || '더 간결하고 정확하게 다듬기';
  const system = [
    { type: 'text', text: BASE_RULES + '\n\n지금 하는 일: 사용자가 정리 문서에서 선택한 문장을 지시에 맞게 고쳐 씁니다. 사실관계는 원본 발언과 일치해야 하며 새 사실을 더하지 않습니다. 고친 문장만 출력하고 설명, 따옴표, 머리말은 쓰지 않습니다. 원래 문단 수와 목록 구조는 유지합니다.' },
    { type: 'text', text: `[원본 발언 목록]\n${numbered(utts)}`, cache_control: { type: 'ephemeral' } },
  ];
  const user = `[앞 문맥]\n${clip(body.before, 400)}\n\n[선택한 문장]\n${sel}\n\n[뒤 문맥]\n${clip(body.after, 400)}\n\n[지시]\n${instruction}`;
  const r = await callClaude(opts, { system, messages: [{ role: 'user', content: user }], maxTokens: 16000 }, { signal: ctl.signal });
  return { data: { text: r.text.trim() }, usage: r.usage };
}

async function draft(body, ctl) {
  const opts = modelOpts(body);
  const kind = body.kind === 'mail' ? 'mail' : 'official';
  const utts = utterancesOf(body);
  const how = kind === 'official'
    ? '공문 초안입니다. 형식: 1. 관련(근거) 2. 확인된 사항 3. 요청 사항 4. 회신 요청. 간결한 공문서체(~하시기 바랍니다, ~요청드립니다)로 씁니다.'
    : '통화 후 상대방에게 보내는 공유 메일 초안입니다. 감사 인사, 확인된 사항 정리, 요청 사항, 회신 요청의 순서로 정중하고 간결하게 씁니다.';
  const user = [
    `${how} subject에는 제목, body에는 본문 전체를 씁니다. 원본에 없는 사실은 쓰지 않고, 비어 있는 정보는 (대괄호)로 남깁니다.`,
    '',
    metaText(body.meta) && `[문서 정보]\n${metaText(body.meta)}`,
    `[요청할 후속 조치]\n${(body.proposals || []).map((p, i) => `${i + 1}. ${clip(p.title, 200)} — ${clip(p.detail, 400)}`).join('\n') || '(없음)'}`,
    `[확인된 사항]\n${(body.facts || []).map((f, i) => `${i + 1}) ${clip(f, 400)}`).join('\n') || '(없음)'}`,
    `[발언 목록]\n${numbered(utts)}`,
  ].filter(Boolean).join('\n');
  const r = await callClaude(opts, { system: BASE_RULES, messages: [{ role: 'user', content: user }], schema: DRAFT_SCHEMA, maxTokens: 16000 }, { signal: ctl.signal });
  return { data: parseJson(r.text), usage: r.usage };
}

const ROUTES = { '/api/analyze': { fn: analyze, stream: true }, '/api/verify': { fn: verify, stream: true }, '/api/edit': { fn: edit }, '/api/draft': { fn: draft } };

/* ---------- HTTP ---------- */
let PORT = PORT0;
function hostOk(req) {
  const h = (req.headers.host || '').toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}
function sendJson(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new UserError('요청이 너무 큽니다.', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new UserError('잘못된 요청입니다.')); } });
    req.on('error', reject);
  });
}
function explain(err) {
  if (err instanceof UserError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) return { status: 401, message: 'API 키가 올바르지 않거나 만료되었습니다. 키를 다시 설정해 주세요.' };
  if (err instanceof Anthropic.PermissionDeniedError) return { status: 403, message: '이 키로는 선택한 모델을 쓸 수 없습니다. 다른 모델을 선택하거나 키 권한을 확인하세요.' };
  if (err instanceof Anthropic.NotFoundError) return { status: 404, message: '선택한 모델을 찾을 수 없습니다. 다른 모델을 선택해 보세요.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: '요청이 많아 잠시 제한되었습니다. 1분 뒤 다시 시도해 주세요.' };
  if (err instanceof Anthropic.BadRequestError) return { status: 400, message: 'Claude가 요청을 거절했습니다: ' + (err.message || '').slice(0, 300) };
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, message: '인터넷 또는 Claude 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.' };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `Claude 서버 오류(${err.status}). 잠시 뒤 다시 시도해 주세요.` };
  return { status: 500, message: '서버 내부 오류: ' + (err && err.message ? err.message : String(err)) };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) return sendJson(res, 403, { error: '허용되지 않은 접근입니다.' });
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(here, 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, 200, {
        server: true, keySource: keySource(),
        models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
        efforts: EFFORTS,
      });
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'POST' && req.method !== 'DELETE') return sendJson(res, 405, { error: '허용되지 않는 요청입니다.' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return sendJson(res, 403, { error: '허용되지 않은 출처입니다.' });
      if (req.method === 'POST' && !(req.headers['content-type'] || '').includes('application/json')) return sendJson(res, 415, { error: 'JSON만 받을 수 있습니다.' });
    }
    if (url.pathname === '/api/key' && req.method === 'DELETE') {
      const c = readCfg(); delete c.apiKey; writeCfg(c);
      return sendJson(res, 200, { ok: true, keySource: keySource() });
    }
    if (url.pathname === '/api/key' && req.method === 'POST') {
      const { key } = await readBody(req, 4096);
      const k = String(key || '').trim();
      if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k)) throw new UserError('올바른 Anthropic API 키 형식이 아닙니다. (sk-ant- 로 시작)');
      writeCfg({ ...readCfg(), apiKey: k });
      return sendJson(res, 200, { ok: true, keySource: keySource() });
    }
    const route = ROUTES[url.pathname];
    if (route && req.method === 'POST') {
      const body = await readBody(req);
      const ac = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      if (route.stream) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        let chars = 0, last = 0;
        const ctl = { signal: ac.signal, onText: (t) => { chars += t.length; const now = Date.now(); if (now - last > 400) { last = now; res.write(JSON.stringify({ t: 'progress', chars }) + '\n'); } } };
        try {
          const out = await route.fn(body, ctl);
          res.end(JSON.stringify({ t: 'done', ...out }) + '\n');
        } catch (err) {
          if (ac.signal.aborted) return res.end();
          const e = explain(err);
          res.end(JSON.stringify({ t: 'error', message: e.message }) + '\n');
        }
        return;
      }
      try {
        const out = await route.fn(body, { signal: ac.signal });
        return sendJson(res, 200, out);
      } catch (err) {
        if (ac.signal.aborted) return res.end();
        const e = explain(err);
        return sendJson(res, e.status, { error: e.message });
      }
    }
    sendJson(res, 404, { error: '찾을 수 없습니다.' });
  } catch (err) {
    const e = explain(err);
    if (!res.headersSent) sendJson(res, e.status, { error: e.message }); else res.end();
  }
});

function listen(port, tries = 0) {
  PORT = port;
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 20) listen(port + 1, tries + 1);
    else { console.error('서버를 시작하지 못했습니다:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log('\n녹취록 편집기가 실행 중입니다 →', url);
    console.log('종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.\n');
    if (process.env.NO_OPEN !== '1') {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
      exec(`${opener} ${url}`, () => {});
    }
  });
}
listen(PORT0);
