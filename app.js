'use strict';
/* =========================================================
   퀵가계부 1단계 (개인용)
   - 데이터는 이 기기 브라우저(localStorage)에만 저장됩니다.
   - 원본 카드/은행 내역(raws)과 가공된 지출(entries)을 따로 보관합니다.
   ========================================================= */

const STORE_KEY = 'quick-gagyebu-v1';

// ---------- 카테고리 (여기를 고치면 카테고리가 바뀝니다) ----------
const TREE = {
  '식비': ['편의점', '식당', '배달', '장보기'],
  '카페': [],
  '교통': [],
  '쇼핑': [],
  '기타': ['편의점(생활용품)', '쿠팡 배달', '그 외']
};
const CATS = Object.keys(TREE);

// ---------- 기본 자동 분류 규칙 (가맹점 이름에 이 단어가 있으면) ----------
// 위에 있는 규칙이 먼저 적용됩니다. 직접 정리하면 새 규칙이 맨 위에 추가돼요.
const DEFAULT_RULES = [
  ['이마트24', '식비', '편의점'], ['GS25', '식비', '편의점'], ['지에스25', '식비', '편의점'],
  ['씨유', '식비', '편의점'], ['CU', '식비', '편의점'], ['세븐일레븐', '식비', '편의점'], ['미니스톱', '식비', '편의점'],
  ['배달의민족', '식비', '배달'], ['우아한형제들', '식비', '배달'], ['쿠팡이츠', '식비', '배달'], ['요기요', '식비', '배달'],
  ['이마트', '식비', '장보기'], ['홈플러스', '식비', '장보기'], ['롯데마트', '식비', '장보기'], ['하나로마트', '식비', '장보기'], ['식자재', '식비', '장보기'],
  ['쿠팡', '기타', '쿠팡 배달'],
  ['스타벅스', '카페', ''], ['투썸', '카페', ''], ['이디야', '카페', ''], ['메가엠지씨', '카페', ''], ['메가커피', '카페', ''],
  ['빽다방', '카페', ''], ['컴포즈', '카페', ''], ['커피', '카페', ''], ['카페', '카페', ''],
  ['티머니', '교통', ''], ['버스', '교통', ''], ['택시', '교통', ''], ['카카오T', '교통', ''], ['코레일', '교통', ''],
  ['SRT', '교통', ''], ['주유', '교통', ''], ['고속도로', '교통', ''],
  ['다이소', '쇼핑', ''], ['올리브영', '쇼핑', ''], ['무신사', '쇼핑', '']
];

// ---------- 데이터 ----------
function freshDB() {
  return {
    v: 1,
    userId: 'me', // 나중에 여러 사용자로 확장할 때 쓰는 칸
    entries: [],  // 가공된 지출 (화면에 보이는 것)
    raws: [],     // 업로드한 카드/은행 원본 내역
    rules: DEFAULT_RULES.map(([k, c, s]) => ({ k, c, s, learned: false })),
    settings: {
      accounts: ['현금'],
      excludeWords: ['본인이체', '내계좌', '카드대금'],
      useLocation: true,
      lastAccount: ''
    }
  };
}
function loadDB() {
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s) {
      const d = JSON.parse(s);
      const base = freshDB();
      return Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) });
    }
  } catch (e) { /* 저장소를 못 읽으면 새로 시작 */ }
  return freshDB();
}
let db = loadDB();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('저장에 실패했어요. 설정 › 백업을 먼저 해주세요.'); }
}
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

// ---------- 화면 상태 ----------
const emptyPick = () => ({ cat: null, sub: null, open: null });
const ui = {
  tab: 'record',
  amount: '', memo: '', account: db.settings.lastAccount || '',
  pick: { rec: emptyPick(), rcl: emptyPick() },
  fresh: null,
  rMemo: '', rDecision: null, rDone: 0, skipped: [], rCurrent: null,
  month: '', hCat: '전체', hAcc: '전체', q: '',
  sOpen: '식비'
};

// ---------- 도우미 ----------
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s == null ? '' : s).replace(/\s/g, '').toUpperCase();
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ymOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const WD = '일월화수목금토';
ui.month = ymOf(new Date());

function dayLabel(key) {
  const d = new Date(key + 'T00:00:00');
  const today = ymd(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  if (key === today) return '오늘 · ' + base;
  if (key === ymd(y)) return '어제 · ' + base;
  return base;
}
function timeText(iso, noTime) {
  if (noTime) return '시간 정보 없음';
  const d = new Date(iso);
  const h = d.getHours();
  return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 ? 12 : h % 12) + ':' + pad(d.getMinutes());
}
function pathOf(e) {
  if (e.status === 'pending') return '회상 대기';
  return e.cat + (e.sub ? ' › ' + e.sub : '');
}
function sourceText(e) {
  if (e.source === 'import') return '카드 내역';
  return e.rawId ? '카드 매칭' : '퀵 기록';
}
const ICON = {
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
}
function openModal(html) { const m = $('#modal'); m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>'; m.hidden = false; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

// ---------- 규칙 / 제외 ----------
function matchRule(text) {
  const n = norm(text);
  if (!n) return null;
  return db.rules.find((r) => r.k && n.includes(norm(r.k))) || null;
}
function isExcluded(text) {
  const n = norm(text);
  return db.settings.excludeWords.some((w) => w && n.includes(norm(w)));
}
function learnRule(merchant, cat, sub) {
  const k = String(merchant || '').trim();
  if (!k || !cat || cat === '미분류') return;
  const found = db.rules.find((r) => norm(r.k) === norm(k));
  if (found) { found.c = cat; found.s = sub || ''; return; }
  db.rules.unshift({ k, c: cat, s: sub || '', learned: true });
}

// ---------- 목록 계산 ----------
const pendingList = () => db.entries.filter((e) => e.status === 'pending').sort((a, b) => b.at.localeCompare(a.at));
function recallQueue() {
  const list = pendingList();
  const later = ui.skipped.map((id) => list.find((e) => e.id === id)).filter(Boolean);
  return list.filter((e) => !ui.skipped.includes(e.id)).concat(later);
}
const monthEntries = (m) => db.entries.filter((e) => ymOf(new Date(e.at)) === m);
const sum = (list) => list.reduce((s, e) => s + e.amount, 0);

// ---------- 카테고리 선택 UI (기록·회상 공용) ----------
function catPicker(scope, emptyHint) {
  const p = ui.pick[scope];
  const hint = p.open ? `${p.open} 세부 항목을 골라주세요`
    : (p.cat ? '선택: ' + p.cat + (p.sub ? ' › ' + p.sub : '') : emptyHint);
  const cats = CATS.map((c) => {
    const has = TREE[c].length > 0;
    return `<button type="button" class="chip ${p.cat === c ? 'on' : ''}" data-act="cat" data-scope="${scope}" data-v="${esc(c)}">${esc(c)}${has ? ' ▾' : ''}</button>`;
  }).join('');
  const subs = p.open ? `<div class="subs">${TREE[p.open].map((s) =>
    `<button type="button" class="chip ${p.sub === s ? 'on' : ''}" data-act="sub" data-scope="${scope}" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '';
  return `<div class="field"><span class="hint">${esc(hint)}</span><div class="cats">${cats}</div>${subs}</div>`;
}
function pickCat(scope, c) {
  const p = ui.pick[scope];
  if (TREE[c].length) { p.open = p.open === c ? null : c; p.cat = c; p.sub = null; }
  else { p.cat = p.cat === c ? null : c; p.sub = null; p.open = null; }
}
function accountOptions(selected, withNone) {
  const opts = (withNone ? ['<option value="">미정 (나중에 카드 내역으로 채움)</option>'] : [])
    .concat(db.settings.accounts.map((a) => `<option value="${esc(a)}" ${a === selected ? 'selected' : ''}>${esc(a)}</option>`));
  return opts.join('');
}
function catOptions(cat, sub, withPending) {
  const out = [];
  if (withPending) out.push(`<option value="" ${!cat ? 'selected' : ''}>정리 안 함 (회상 대기)</option>`);
  CATS.forEach((c) => {
    out.push(`<option value="${esc(c)}|" ${cat === c && !sub ? 'selected' : ''}>${esc(c)}</option>`);
    TREE[c].forEach((s) => out.push(`<option value="${esc(c)}|${esc(s)}" ${cat === c && sub === s ? 'selected' : ''}>${esc(c)} › ${esc(s)}</option>`));
  });
  out.push(`<option value="미분류|" ${cat === '미분류' ? 'selected' : ''}>미분류</option>`);
  return out.join('');
}

// ---------- 날짜별 목록 ----------
function groupedList(list) {
  if (!list.length) return '';
  const groups = [];
  list.forEach((e) => {
    const k = ymd(new Date(e.at));
    let g = groups[groups.length - 1];
    if (!g || g.k !== k) { g = { k, items: [] }; groups.push(g); }
    g.items.push(e);
  });
  return groups.map((g) => `
    <div class="group">
      <div class="group-head"><b>${esc(dayLabel(g.k))}</b><span class="num muted">합계 ${fmt(sum(g.items))}원</span></div>
      <div class="list">${g.items.map(rowHTML).join('')}</div>
    </div>`).join('');
}
function rowHTML(e) {
  const extra = e.memo || e.merchant;
  const meta = [timeText(e.at, e.noTime), e.account || '결제 미정', extra, sourceText(e)].filter(Boolean).join(' · ');
  return `<button type="button" class="row ${ui.fresh === e.id ? 'fresh' : ''}" data-act="edit" data-id="${e.id}">
    <span class="l"><span class="t ${e.status === 'pending' ? 'warn' : ''}">${esc(pathOf(e))}</span><span class="m">${esc(meta)}${ui.fresh === e.id ? ' · 방금' : ''}</span></span>
    <span class="a num">${fmt(e.amount)}원</span></button>`;
}

// =========================================================
// 1. 기록 화면
// =========================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function viewRecord() {
  const now = new Date();
  const pending = pendingList().length;
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 2);
  const recent = db.entries.filter((e) => new Date(e.at) >= from).sort((a, b) => b.at.localeCompare(a.at));
  return `
  <header class="top">
    <div><div class="sub">${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일</div><h1>얼마 썼어요?</h1></div>
    <button type="button" class="pill" data-act="tab" data-tab="recall"><span class="dot"></span>회상 대기 ${pending}건</button>
  </header>
  <section class="card">
    <div class="amount"><span class="num big ${ui.amount ? '' : 'zero'}">${ui.amount ? fmt(ui.amount) : '0'}</span><span class="won">원</span></div>
    ${ui.memo ? `<div class="memo-line">“${esc(ui.memo)}”</div>` : ''}
    <div class="tags">
      <span class="tag">${ICON.clock}시간 자동 기록</span>
      <span class="tag">${ICON.pin}${db.settings.useLocation ? '위치 자동 기록' : '위치 기록 꺼짐'}</span>
    </div>
    <label class="inline-field">결제<select data-change="account">${accountOptions(ui.account, true)}</select></label>
  </section>
  ${catPicker('rec', '카테고리 · 지금 안 골라도 돼요')}
  <div class="keypad">
    ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'].map((k) =>
      `<button type="button" class="key num" data-act="key" data-v="${k}" aria-label="${k === 'back' ? '지우기' : k}">${k === 'back' ? '←' : k}</button>`).join('')}
  </div>
  <div class="actions">
    ${SR ? `<button type="button" class="btn btn-mic" data-act="voice" aria-label="음성으로 기록">${ICON.mic}</button>` : ''}
    <button type="button" class="btn btn-primary" data-act="saveQuick">기록하기</button>
  </div>
  <div class="scroll-hint">내려서 최근 기록 보기${ICON.down}</div>
  <h2>최근 기록</h2>
  ${groupedList(recent) || '<div class="empty">아직 기록이 없어요. 금액을 누르고 기록하기!</div>'}`;
}
function pressKey(v) {
  let a = ui.amount;
  if (v === 'back') a = a.slice(0, -1);
  else if (a.length < 9) a = (a === '' && (v === '0' || v === '00')) ? '' : a + v;
  ui.amount = a;
}
function saveQuick() {
  if (!ui.amount) { toast('금액을 먼저 눌러주세요'); return; }
  const p = ui.pick.rec;
  const now = new Date().toISOString();
  const e = {
    id: uid(), userId: db.userId, at: now, noTime: false, amount: Number(ui.amount),
    cat: p.cat || '', sub: p.sub || '', memo: ui.memo, account: ui.account,
    source: 'quick', status: p.cat ? 'done' : 'pending',
    merchant: '', rawId: null, suggest: null, lat: null, lng: null, createdAt: now
  };
  db.entries.push(e);
  db.settings.lastAccount = ui.account;
  save();
  toast(`${fmt(e.amount)}원 저장됨${p.cat ? ' · ' + pathOf(e) : ' · 나중에 회상에서 정리'}`);
  ui.amount = ''; ui.memo = ''; ui.pick.rec = emptyPick(); ui.fresh = e.id;
  render();
  if (db.settings.useLocation && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      e.lat = +pos.coords.latitude.toFixed(5); e.lng = +pos.coords.longitude.toFixed(5); save();
    }, () => {}, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  }
}

// 음성: "점심 만이천" → 12000
function parseKoNumber(text) {
  const runs = String(text).replace(/[,\s]/g, '').match(/[0-9영일이삼사오육칠팔구십백천만억]+/g) || [];
  const D = { '영': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9 };
  const S = { '십': 10, '백': 100, '천': 1000 };
  const B = { '만': 10000, '억': 100000000 };
  let best = 0;
  runs.forEach((run) => {
    let total = 0, section = 0, num = 0;
    for (let i = 0; i < run.length; i++) {
      const ch = run[i];
      if (/[0-9]/.test(ch)) { let j = i; while (j < run.length && /[0-9]/.test(run[j])) j++; num = parseInt(run.slice(i, j), 10); i = j - 1; }
      else if (ch in D) num = D[ch];
      else if (ch in S) { section += (num || 1) * S[ch]; num = 0; }
      else if (ch in B) { section += num; total += (section || 1) * B[ch]; section = 0; num = 0; }
    }
    total += section + num;
    if (total > best) best = total;
  });
  return best;
}
function startVoice() {
  try {
    const r = new SR();
    r.lang = 'ko-KR'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (ev) => {
      const t = ev.results[0][0].transcript;
      const n = parseKoNumber(t);
      if (n) ui.amount = String(n).slice(0, 9);
      ui.memo = t;
      render();
      toast(n ? `“${t}” → ${fmt(n)}원\n맞으면 기록하기를 눌러주세요` : `“${t}”\n금액을 못 알아들었어요. 숫자로 눌러주세요`);
    };
    r.onerror = () => toast('음성 인식을 못 했어요');
    r.start();
    toast('듣고 있어요… 예: “점심 만이천”');
  } catch (e) { toast('이 기기에서는 음성 입력이 안 돼요'); }
}

// =========================================================
// 2. 회상 화면
// =========================================================
function viewRecall() {
  const q = recallQueue();
  const total = ui.rDone + q.length;
  const head = (t) => `
  <header class="top"><h1>이거 뭐였어요?</h1><span class="num muted">${t}</span></header>
  <div class="progress"><i style="width:${total ? Math.round(ui.rDone / total * 100) : 100}%"></i></div>`;
  if (!q.length) {
    return head(total ? `${total} / ${total}` : '') + `
    <div class="card"><h2 style="margin:0">모두 정리했어요</h2>
    <p class="note">${ui.rDone ? `이번에 ${ui.rDone}건을 정리했어요. ` : ''}정리한 기록은 내역과 요약에 바로 반영돼요.</p>
    <button type="button" class="btn btn-ghost" data-act="tab" data-tab="record">기록 화면으로</button></div>`;
  }
  const e = q[0];
  if (ui.rCurrent !== e.id) { ui.rCurrent = e.id; ui.rMemo = e.memo || ''; ui.rDecision = null; ui.pick.rcl = emptyPick(); }
  const p = ui.pick.rcl;
  const d = new Date(e.at);
  const where = e.merchant
    ? `<div class="place">가맹점: ${esc(e.merchant)}</div>`
    : (e.lat != null ? `<div class="place">${ICON.pin}<a href="https://map.kakao.com/link/map/기록한곳,${e.lat},${e.lng}" target="_blank" rel="noopener">기록한 위치 지도로 보기</a></div>`
      : `<div class="place muted">${ICON.pin}위치 정보 없음</div>`);
  let suggest = '';
  if (e.suggest && ui.rDecision !== 'no') {
    const sg = e.suggest;
    suggest = `<div class="suggest">
      <div class="s-title">같은 금액·비슷한 시간의 카드 내역이 있어요 · 혹시 이거?</div>
      <div class="s-main">${esc(sg.merchant || '(내용 없음)')} · <span class="num">${fmt(e.amount)}</span>원${sg.cat ? ` → ${esc(sg.cat)}${sg.sub ? ' › ' + esc(sg.sub) : ''}` : ''}</div>
      ${ui.rDecision === 'yes' ? '<div class="small muted">연결했어요. 카테고리 확인 후 저장해주세요.</div>' :
      `<div class="s-actions"><button type="button" class="btn btn-primary" data-act="sgYes">맞아요</button><button type="button" class="btn btn-ghost" data-act="sgNo">아니에요</button></div>`}
    </div>`;
  }
  return head(`${ui.rDone + 1} / ${total}`) + `
  <section class="card">
    <div class="muted">${esc(dayLabel(ymd(d)))} ${esc(timeText(e.at, e.noTime))}</div>
    <div class="amount" style="justify-content:flex-start"><span class="num big">${fmt(e.amount)}</span><span class="won">원</span></div>
    ${where}
    <div class="small muted">${esc(e.account || '결제 미정')} · ${esc(sourceText(e))}</div>
  </section>
  ${suggest}
  ${catPicker('rcl', '카테고리를 골라주세요')}
  <label class="field"><span>메모 (선택)</span><input type="text" data-input="rMemo" value="${esc(ui.rMemo)}" placeholder="예: 팀 점심, 동생 선물"></label>
  <div class="actions">
    <button type="button" class="btn btn-ghost" data-act="rLater">나중에</button>
    <button type="button" class="btn btn-ghost" data-act="rForget">기억 안 나요</button>
    <button type="button" class="btn btn-primary" data-act="rSave" ${p.cat ? '' : 'disabled'}>저장</button>
  </div>`;
}
function linkSuggestion(e) {
  // 제안을 "아니에요" 하지 않았다면 같은 지출로 연결
  if (!e.suggest) return;
  const raw = db.raws.find((r) => r.id === e.suggest.rawId);
  if (ui.rDecision === 'no') {
    if (raw) separateRaw(raw);
  } else {
    e.rawId = e.suggest.rawId;
    e.merchant = e.merchant || e.suggest.merchant;
    if (raw) { raw.linkedEntryId = e.id; if (!e.account) e.account = raw.account; }
  }
  e.suggest = null;
}
function finishRecall(cat, sub) {
  const e = recallQueue()[0];
  if (!e) return;
  linkSuggestion(e);
  e.cat = cat; e.sub = sub || ''; e.memo = ui.rMemo.trim(); e.status = 'done';
  if (e.merchant) learnRule(e.merchant, cat, sub);
  ui.skipped = ui.skipped.filter((id) => id !== e.id);
  ui.rDone++; ui.rCurrent = null;
  save(); render();
  toast(`${fmt(e.amount)}원 → ${pathOf(e)}`);
}

// =========================================================
// 3. 내역 화면
// =========================================================
function monthNav() {
  const [y, m] = ui.month.split('-').map(Number);
  return `<div style="display:flex;align-items:center">
    <button type="button" class="icon-btn" data-act="month" data-d="-1" aria-label="이전 달">${ICON.left}</button>
    <span style="font-size:15px;font-weight:500">${y}년 ${m}월</span>
    <button type="button" class="icon-btn" data-act="month" data-d="1" aria-label="다음 달">${ICON.right}</button></div>`;
}
function historyFiltered() {
  const q = ui.q.trim();
  return monthEntries(ui.month).filter((e) => {
    if (ui.hCat === '회상 대기') { if (e.status !== 'pending') return false; }
    else if (ui.hCat !== '전체' && (e.status === 'pending' || e.cat !== ui.hCat)) return false;
    if (ui.hAcc !== '전체' && (e.account || '결제 미정') !== ui.hAcc) return false;
    if (q) {
      const hay = norm([pathOf(e), e.memo, e.merchant, e.account || '결제 미정', e.amount, fmt(e.amount)].join(' '));
      if (!hay.includes(norm(q))) return false;
    }
    return true;
  }).sort((a, b) => b.at.localeCompare(a.at));
}
function viewHistory() {
  const all = monthEntries(ui.month);
  const accs = ['전체'].concat(db.settings.accounts);
  if (all.some((e) => !e.account)) accs.push('결제 미정');
  const excluded = db.raws.filter((r) => r.excluded && ymOf(new Date(r.at)) === ui.month);
  const chip = (act, v, cur, warn) => `<button type="button" class="chip ${cur === v ? 'on' : ''} ${warn ? 'warn-chip' : ''}" data-act="${act}" data-v="${esc(v)}">${esc(v)}</button>`;
  return `
  <header class="top"><h1>내역</h1><div style="display:flex;align-items:center">${monthNav()}
    <button type="button" class="icon-btn" data-act="tab" data-tab="settings" aria-label="설정">${ICON.gear}</button></div></header>
  <section class="card">
    <div><div class="small muted" id="hLabel"></div>
    <div class="big-total"><span class="num" id="hTotal"></span><span class="won">원</span></div>
    <div class="small muted" id="hCount"></div></div>
    ${excluded.length ? `<div class="badges"><span class="badge">이체·카드대금 ${excluded.length}건 · ${fmt(sum(excluded))}원은 지출에서 제외</span></div>` : ''}
    <button type="button" class="btn btn-upload" data-act="import">${ICON.up}카드·은행 내역 올리기</button>
  </section>
  <label class="field"><span>검색</span><input type="text" data-input="q" value="${esc(ui.q)}" placeholder="메모, 가맹점, 카테고리, 계좌, 금액"></label>
  <div class="scroll-chips">${['전체'].concat(CATS, ['미분류']).map((c) => chip('hCat', c, ui.hCat)).join('')}${chip('hCat', '회상 대기', ui.hCat, true)}</div>
  <div class="scroll-chips">${accs.map((a) => chip('hAcc', a, ui.hAcc)).join('')}</div>
  <div id="hList" style="display:flex;flex-direction:column;gap:14px"></div>`;
}
function updateHistory() {
  const list = historyFiltered();
  const filtered = ui.hCat !== '전체' || ui.hAcc !== '전체' || ui.q.trim();
  const [, m] = ui.month.split('-').map(Number);
  $('#hLabel').textContent = filtered ? `필터 결과 · ${m}월` : `${m}월 지출`;
  $('#hTotal').textContent = fmt(sum(list));
  $('#hCount').textContent = `${list.length}건 · 내 계좌 간 이체는 자동 제외`;
  $('#hList').innerHTML = groupedList(list) || `<div class="empty">${monthEntries(ui.month).length ? '조건에 맞는 기록이 없어요' : '이 달에는 기록이 없어요'}</div>`;
}

// =========================================================
// 4. 요약 화면
// =========================================================
function viewSummary() {
  const list = monthEntries(ui.month);
  const total = sum(list);
  const [y, m] = ui.month.split('-').map(Number);
  // 지난달 같은 기간과 비교
  const now = new Date();
  const isCurrent = ui.month === ymOf(now);
  const lastDay = isCurrent ? now.getDate() : 31;
  const prev = ymOf(new Date(y, m - 2, 1));
  const prevSum = sum(monthEntries(prev).filter((e) => new Date(e.at).getDate() <= lastDay));
  const curSum = sum(list.filter((e) => new Date(e.at).getDate() <= lastDay));
  let compare = '<span class="muted">지난달 기록이 없어 비교할 수 없어요</span>';
  if (prevSum > 0) {
    const diff = curSum - prevSum;
    const pct = Math.round(Math.abs(diff) / prevSum * 100);
    compare = diff >= 0
      ? `지난달 같은 기간보다 <b class="warn">${fmt(diff)}원 (${pct}%) 더 씀</b>`
      : `지난달 같은 기간보다 <b style="color:var(--green)">${fmt(-diff)}원 (${pct}%) 덜 씀</b>`;
  }
  const excluded = db.raws.filter((r) => r.excluded && ymOf(new Date(r.at)) === ui.month);
  const pend = list.filter((e) => e.status === 'pending');

  // 카테고리별
  const rows = CATS.concat(['미분류', '회상 대기']).map((c) => {
    const items = c === '회상 대기' ? pend : list.filter((e) => e.status !== 'pending' && e.cat === c);
    const subs = (TREE[c] || []).map((s) => ({ s, v: sum(items.filter((e) => e.sub === s)) }));
    const none = sum(items.filter((e) => !e.sub));
    if (TREE[c] && TREE[c].length && none) subs.push({ s: '세부 미지정', v: none });
    return { c, v: sum(items), subs: subs.filter((x) => x.v > 0).sort((a, b) => b.v - a.v) };
  }).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...rows.map((r) => r.v));
  const catHTML = rows.map((r) => {
    const open = ui.sOpen === r.c && r.subs.length > 0;
    const color = r.c === '회상 대기' ? 'var(--warn-bar)' : (r.c === '미분류' ? 'var(--gray-bar)' : 'var(--green)');
    const subMax = Math.max(1, ...r.subs.map((x) => x.v));
    return `<div>
      <button type="button" class="bar-row" data-act="sOpen" data-v="${esc(r.c)}" ${r.subs.length ? `aria-expanded="${open}"` : ''}>
        <span class="line1"><span class="${r.c === '회상 대기' ? 'warn' : ''}">${esc(r.c)}${r.subs.length ? (open ? ' ▴' : ' ▾') : ''} <span class="small muted">${Math.round(r.v / total * 100)}%</span></span><span class="num">${fmt(r.v)}원</span></span>
        <span class="bar"><i style="width:${Math.round(r.v / max * 100)}%;background:${color}"></i></span>
      </button>
      ${open ? `<div class="sub-bars">${r.subs.map((x) => `<div><div class="line1"><span>${esc(x.s)}</span><span class="num">${fmt(x.v)}원</span></div><div class="bar"><i style="width:${Math.round(x.v / subMax * 100)}%"></i></div></div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  // 계좌별
  const accMap = {};
  list.forEach((e) => { const k = e.account || '결제 미정'; accMap[k] = (accMap[k] || 0) + e.amount; });
  const accRows = Object.entries(accMap).sort((a, b) => b[1] - a[1]);
  const accMax = Math.max(1, ...accRows.map((a) => a[1]));
  const accHTML = accRows.map(([k, v]) => `<div class="bar-row">
    <span class="line1"><span>${esc(k)} <span class="small muted">${Math.round(v / total * 100)}%</span></span><span class="num">${fmt(v)}원</span></span>
    <span class="bar"><i style="width:${Math.round(v / accMax * 100)}%;background:${k === '결제 미정' ? 'var(--gray-bar)' : 'var(--green)'}"></i></span></div>`).join('');

  return `
  <header class="top"><h1>요약</h1><div style="display:flex;align-items:center">${monthNav()}
    <button type="button" class="icon-btn" data-act="tab" data-tab="settings" aria-label="설정">${ICON.gear}</button></div></header>
  <section class="card">
    <span class="small muted">${m}월 지출${isCurrent ? ` (1~${now.getDate()}일)` : ''}</span>
    <div class="big-total"><span class="num">${fmt(total)}</span><span class="won">원</span></div>
    <div style="font-size:13px;color:var(--ink2)">${compare}</div>
    <div class="badges">
      ${excluded.length ? `<span class="badge">내 계좌 간 이체·카드대금 ${excluded.length}건 · ${fmt(sum(excluded))}원 제외</span>` : ''}
      ${pend.length ? `<button type="button" class="badge warn-b" data-act="tab" data-tab="recall">회상 대기 ${fmt(sum(pend))}원 정리하기</button>` : ''}
    </div>
  </section>
  ${total ? `
  <section class="card" style="gap:2px">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">어디에 썼나</h2><span class="small muted">눌러서 세부 보기</span></div>
    ${catHTML}
  </section>
  <section class="card">
    <div><h2 style="margin:0">어느 계좌에서 나갔나</h2><span class="small muted">계좌·카드별로 모아서 보기</span></div>
    ${accHTML}
  </section>` : '<div class="empty">이 달에는 기록이 없어요</div>'}`;
}

// =========================================================
// 5. 설정 화면
// =========================================================
function viewSettings() {
  const s = db.settings;
  const learned = db.rules.filter((r) => r.learned);
  const ruleRow = (r) => `<div class="rule"><span><b>${esc(r.k)}</b> → ${esc(r.c)}${r.s ? ' › ' + esc(r.s) : ''}</span>
    <button type="button" data-act="delRule" data-v="${esc(r.k)}" aria-label="${esc(r.k)} 규칙 삭제">${ICON.x}</button></div>`;
  return `
  <header class="top"><h1>설정</h1><button type="button" class="pill" data-act="tab" data-tab="history">닫기</button></header>

  <section class="card">
    <h2 style="margin:0">내 계좌·카드</h2>
    <p class="note">퀵 기록의 "결제" 목록과 카드 내역 올리기에 쓰여요.</p>
    <div class="set-list">${s.accounts.map((a) => `<span class="set-chip">${esc(a)}<button type="button" data-act="delAcc" data-v="${esc(a)}" aria-label="${esc(a)} 삭제">${ICON.x}</button></span>`).join('')}</div>
    <div class="add-row"><input type="text" id="newAcc" placeholder="예: 국민카드, 카카오뱅크" aria-label="계좌 이름"><button type="button" class="btn btn-primary" data-act="addAcc">추가</button></div>
  </section>

  <section class="card">
    <h2 style="margin:0">지출에서 뺄 단어</h2>
    <p class="note">카드 내역에서 이 단어가 들어간 줄은 지출로 세지 않아요. <b>내 이름</b>(내 계좌끼리 옮긴 돈)과 <b>카드대금</b>(통장에서 카드값이 빠져나간 것, 카드 내역과 이중 계산 방지)을 넣어두세요.</p>
    <div class="set-list">${s.excludeWords.map((w) => `<span class="set-chip">${esc(w)}<button type="button" data-act="delWord" data-v="${esc(w)}" aria-label="${esc(w)} 삭제">${ICON.x}</button></span>`).join('')}</div>
    <div class="add-row"><input type="text" id="newWord" placeholder="예: 홍길동, KB카드" aria-label="제외 단어"><button type="button" class="btn btn-primary" data-act="addWord">추가</button></div>
  </section>

  <section class="card">
    <label class="switch">위치 자동 기록<input type="checkbox" data-change="loc" ${s.useLocation ? 'checked' : ''}></label>
    <p class="note">기록할 때 위치를 저장해서 회상할 때 지도로 보여줘요. 위치는 이 폰에만 저장돼요.</p>
  </section>

  <section class="card">
    <h2 style="margin:0">자동 분류 규칙</h2>
    <p class="note">가맹점 이름에 단어가 들어 있으면 자동으로 분류해요. 회상에서 정리하면 여기에 저절로 추가돼요.</p>
    <div class="add-row"><input type="text" id="newRuleK" placeholder="가맹점 단어" aria-label="가맹점 단어"></div>
    <div class="add-row"><select id="newRuleC" aria-label="카테고리">${catOptions('', '', false)}</select><button type="button" class="btn btn-primary" data-act="addRule">추가</button></div>
    <div><div class="label">내가 만든 규칙 ${learned.length}개</div>${learned.map(ruleRow).join('') || '<p class="note">아직 없어요</p>'}</div>
    <details><summary class="small muted" style="min-height:32px">기본 규칙 ${db.rules.length - learned.length}개 보기</summary>${db.rules.filter((r) => !r.learned).map(ruleRow).join('')}</details>
  </section>

  <section class="card">
    <h2 style="margin:0">백업</h2>
    <p class="note">기록은 이 폰의 브라우저에만 저장돼요. 브라우저 데이터를 지우면 사라지니 가끔 백업 파일을 받아두세요.</p>
    <div class="actions"><button type="button" class="btn btn-ghost" data-act="export">백업 파일 받기</button>
    <label class="btn btn-ghost">백업 불러오기<input type="file" accept=".json,application/json" data-change="restore" hidden></label></div>
    <button type="button" class="btn btn-danger" data-act="wipe">모든 기록 지우기</button>
  </section>
  <p class="note" style="text-align:center">퀵가계부 1단계 · 기록 ${db.entries.length}건 · 원본 내역 ${db.raws.length}건</p>`;
}

// =========================================================
// 기록 수정 창
// =========================================================
function openEdit(id) {
  const e = db.entries.find((x) => x.id === id);
  if (!e) return;
  const d = new Date(e.at);
  const local = `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const accOpts = [`<option value="" ${!e.account ? 'selected' : ''}>결제 미정</option>`]
    .concat(db.settings.accounts.map((a) => `<option value="${esc(a)}" ${a === e.account ? 'selected' : ''}>${esc(a)}</option>`));
  if (e.account && !db.settings.accounts.includes(e.account)) accOpts.push(`<option value="${esc(e.account)}" selected>${esc(e.account)}</option>`);
  openModal(`
    <div class="sheet-head"><h3>기록 고치기</h3><button type="button" class="icon-btn" data-act="close" aria-label="닫기">${ICON.x}</button></div>
    ${e.merchant ? `<div class="small muted">가맹점: ${esc(e.merchant)} · ${esc(sourceText(e))}</div>` : `<div class="small muted">${esc(sourceText(e))}</div>`}
    <label class="field"><span>금액 (원)</span><input type="number" inputmode="numeric" id="eAmount" value="${e.amount}"></label>
    <label class="field"><span>날짜와 시간</span><input type="datetime-local" id="eAt" value="${local}"></label>
    <label class="field"><span>카테고리</span><select id="eCat">${catOptions(e.status === 'pending' ? '' : e.cat, e.sub, true)}</select></label>
    <label class="field"><span>결제</span><select id="eAcc">${accOpts.join('')}</select></label>
    <label class="field"><span>메모</span><input type="text" id="eMemo" value="${esc(e.memo)}"></label>
    <div class="actions"><button type="button" class="btn btn-danger" data-act="delEntry" data-id="${e.id}">삭제</button>
    <button type="button" class="btn btn-primary" data-act="saveEdit" data-id="${e.id}">저장</button></div>`);
}
function saveEdit(id) {
  const e = db.entries.find((x) => x.id === id);
  if (!e) return;
  const amt = Math.round(Number($('#eAmount').value));
  if (!(amt > 0)) { toast('금액을 확인해주세요'); return; }
  const at = new Date($('#eAt').value);
  const [cat, sub] = $('#eCat').value.split('|');
  e.amount = amt;
  if (!isNaN(at)) { e.at = at.toISOString(); e.noTime = false; }
  e.account = $('#eAcc').value;
  e.memo = $('#eMemo').value.trim();
  if (cat) {
    if (e.suggest) { const keep = ui.rDecision; ui.rDecision = null; linkSuggestion(e); ui.rDecision = keep; }
    e.cat = cat; e.sub = sub || ''; e.status = 'done';
    if (e.merchant) learnRule(e.merchant, cat, sub);
  } else { e.cat = ''; e.sub = ''; e.status = 'pending'; }
  save(); closeModal(); render(); toast('고쳤어요');
}
function deleteEntry(id) {
  const e = db.entries.find((x) => x.id === id);
  if (!e || !confirm(`${fmt(e.amount)}원 기록을 지울까요?`)) return;
  db.entries = db.entries.filter((x) => x.id !== id);
  save(); closeModal(); render(); toast('지웠어요');
}

// =========================================================
// 카드·은행 내역 올리기
// =========================================================
function openImport() {
  const opts = db.settings.accounts.filter((a) => a !== '현금')
    .map((a) => `<option value="${esc(a)}" ${a === db.settings.lastImport ? 'selected' : ''}>${esc(a)}</option>`).join('');
  openModal(`
    <div class="sheet-head"><h3>카드·은행 내역 올리기</h3><button type="button" class="icon-btn" data-act="close" aria-label="닫기">${ICON.x}</button></div>
    <p class="note">은행·카드사 앱이나 홈페이지에서 <b>거래내역(이용내역)을 엑셀 또는 CSV로</b> 내려받아 올려주세요. 계좌·카드마다 한 번씩 올리면 돼요. 같은 파일을 두 번 올려도 중복은 자동으로 걸러져요.</p>
    <label class="field"><span>어느 계좌·카드 내역인가요?</span>
      <select id="impAcc">${opts}<option value="__new" ${opts ? '' : 'selected'}>+ 새로 추가</option></select></label>
    <label class="field" id="impNewWrap" ${opts ? 'hidden' : ''}><span>새 계좌·카드 이름</span><input type="text" id="impNew" placeholder="예: 국민카드"></label>
    <label class="field"><span>파일 (.xlsx, .xls, .csv)</span><input type="file" id="impFile" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    <button type="button" class="btn btn-primary" data-act="doImport">읽어서 정리하기</button>
    <div id="impResult"></div>`);
}
function loadXLSX() {
  return new Promise((res, rej) => {
    if (window.XLSX) return res();
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('엑셀 읽기 도구를 못 불러왔어요'));
    document.head.appendChild(s);
  });
}
const KW = {
  date: ['거래일시', '이용일시', '승인일시', '거래일자', '이용일자', '승인일자', '사용일자', '거래일', '이용일', '승인일', '일자', '날짜', '일시', 'DATE'],
  time: ['거래시간', '이용시간', '승인시간', '시각', '시간', 'TIME'],
  amount: ['출금액', '출금금액', '찾으신금액', '지급금액', '이용금액', '승인금액', '결제금액', '사용금액', '거래금액', '금액', 'AMOUNT'],
  merchant: ['가맹점명', '이용가맹점', '가맹점', '이용하신곳', '사용처', '거래처', '기재내용', '거래내용', '내용', '받는분', '메모', '적요'],
  memo: ['적요']
};
function findCol(header, keys, bad) {
  for (const k of keys) {
    const i = header.findIndex((h) => { const n = norm(h); return n.includes(k) && !(bad || []).some((b) => n.includes(b)); });
    if (i >= 0) return i;
  }
  return -1;
}
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const h = (rows[r] || []).map((x) => String(x == null ? '' : x));
    const date = findCol(h, KW.date, ['시간']);
    const amount = findCol(h, KW.amount, ['입금', '잔액', '취소', '예금', '할인', '포인트', '수수료']);
    if (date >= 0 && amount >= 0) {
      let time = findCol(h, KW.time, ['일시']);
      if (time === date) time = -1;
      const merchant = findCol(h, KW.merchant, ['금액']);
      let memo = findCol(h, KW.memo);
      if (memo === merchant) memo = -1;
      return { row: r, date, time, amount, merchant, memo };
    }
  }
  return null;
}
function parseAmount(v) {
  if (typeof v === 'number') return Math.round(v);
  const s = String(v == null ? '' : v).replace(/[,원\s]/g, '');
  if (!s || s.startsWith('-') || s.startsWith('(')) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}
function parseDateCell(v, t) {
  let y, m, d, h = null, mi = null;
  if (v instanceof Date && !isNaN(v)) {
    y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate();
    if (v.getHours() || v.getMinutes()) { h = v.getHours(); mi = v.getMinutes(); }
  } else if (typeof v === 'number' && v > 20000 && v < 80000) {
    const dt = new Date(Math.round((v - 25569) * 86400000));
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    const frac = v % 1;
    if (frac > 0) { const mins = Math.round(frac * 1440); h = Math.floor(mins / 60); mi = mins % 60; }
  } else {
    const s = String(v == null ? '' : v).trim();
    let mt;
    if ((mt = s.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
    else if ((mt = s.match(/^(\d{4})(\d{2})(\d{2})/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
    else if ((mt = s.match(/^(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/))) { y = 2000 + +mt[1]; m = +mt[2]; d = +mt[3]; }
    else if ((mt = s.match(/^(\d{1,2})[.\-\/](\d{1,2})(?!\d)/))) { y = new Date().getFullYear(); m = +mt[1]; d = +mt[2]; }
    else return null;
    const rest = s.slice(mt.index + mt[0].length);
    const tm = rest.match(/(\d{1,2}):(\d{2})/) || (mt[0].length === 8 && rest.match(/^(\d{2})(\d{2})/));
    if (tm) { h = +tm[1]; mi = +tm[2]; }
  }
  if (t != null && t !== '') {
    if (t instanceof Date && !isNaN(t)) { h = t.getHours(); mi = t.getMinutes(); }
    else if (typeof t === 'number' && t < 1) { const mins = Math.round(t * 1440); h = Math.floor(mins / 60); mi = mins % 60; }
    else {
      const ts = String(t).trim();
      const tm = ts.match(/(\d{1,2}):(\d{2})/) || ts.match(/^(\d{2})(\d{2})(\d{2})?$/);
      if (tm) { h = +tm[1]; mi = +tm[2]; }
    }
  }
  if (!y || !m || !d || m > 12 || d > 31 || (h != null && h > 23)) return null;
  return { date: new Date(y, m - 1, d, h == null ? 12 : h, mi || 0), hasTime: h != null };
}
async function readSheetRows(file) {
  await loadXLSX();
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  }
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const h = findHeader(rows);
    if (h) return { rows, h };
  }
  return null;
}
function findQuickMatch(raw) {
  const rt = new Date(raw.at).getTime();
  let best = null, bestDiff = Infinity;
  db.entries.forEach((e) => {
    if (e.source !== 'quick' || e.rawId || e.suggest || e.amount !== raw.amount) return;
    if (e.account && e.account !== raw.account) return;
    const et = new Date(e.at).getTime();
    let diff;
    if (raw.hasTime) { diff = Math.abs(et - rt) / 60000; if (diff > 180) return; }
    else { if (ymd(new Date(e.at)) !== ymd(new Date(raw.at))) return; diff = 0; }
    if (diff < bestDiff) { best = e; bestDiff = diff; }
  });
  return best;
}
function entryFromRaw(raw) {
  const rule = matchRule(raw.merchant);
  return {
    id: uid(), userId: db.userId, at: raw.at, noTime: !raw.hasTime, amount: raw.amount,
    cat: rule ? rule.c : '', sub: rule ? rule.s : '', memo: '', account: raw.account,
    source: 'import', status: rule ? 'done' : 'pending', merchant: raw.merchant,
    rawId: raw.id, suggest: null, lat: null, lng: null, createdAt: new Date().toISOString()
  };
}
function separateRaw(raw) {
  // "아니에요": 카드 내역을 별도 지출로 등록
  const e = entryFromRaw(raw);
  db.entries.push(e);
  raw.linkedEntryId = e.id;
}
async function doImport() {
  const sel = $('#impAcc').value;
  const account = (sel === '__new' ? $('#impNew').value : sel).trim();
  const file = $('#impFile').files[0];
  const out = $('#impResult');
  if (!account) { toast('계좌·카드 이름을 정해주세요'); return; }
  if (!file) { toast('파일을 골라주세요'); return; }
  out.innerHTML = '<p class="note">읽는 중…</p>';
  let parsed;
  try { parsed = await readSheetRows(file); }
  catch (err) { out.innerHTML = `<p class="note warn">파일을 읽지 못했어요. (${esc(err.message)})</p>`; return; }
  if (!parsed) {
    out.innerHTML = '<p class="note warn">날짜·금액 칸을 찾지 못했어요. 파일 첫 줄(제목 줄)에 어떤 이름이 있는지 알려주시면 맞춰드릴게요.</p>';
    return;
  }
  if (!db.settings.accounts.includes(account)) db.settings.accounts.push(account);
  db.settings.lastImport = account;
  const { rows, h } = parsed;
  const res = { read: 0, added: 0, auto: 0, matched: 0, excluded: 0, dup: 0, skipped: 0 };
  const now = new Date().toISOString();
  for (let i = h.row + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const dt = parseDateCell(row[h.date], h.time >= 0 ? row[h.time] : null);
    const amount = parseAmount(row[h.amount]);
    if (!dt || !(amount > 0)) { if (row.some((c) => String(c).trim())) res.skipped++; continue; }
    res.read++;
    const memo = h.memo >= 0 ? String(row[h.memo] || '').trim() : '';
    const merchant = (h.merchant >= 0 ? String(row[h.merchant] || '').trim() : '') || memo;
    const timeKey = dt.hasTime ? `${pad(dt.date.getHours())}:${pad(dt.date.getMinutes())}` : '';
    const hash = [account, ymd(dt.date), timeKey, amount, norm(merchant)].join('|');
    if (db.raws.some((r) => r.hash === hash)) { res.dup++; continue; }
    const raw = { id: uid(), userId: db.userId, account, at: dt.date.toISOString(), hasTime: dt.hasTime, amount, merchant, hash, excluded: false, linkedEntryId: null, importedAt: now };
    db.raws.push(raw);
    raw.memo = memo;
    if (isExcluded(merchant + ' ' + memo)) { raw.excluded = true; res.excluded++; continue; }
    const cand = findQuickMatch(raw);
    if (cand) {
      res.matched++;
      raw.linkedEntryId = cand.id;
      if (!cand.account) cand.account = account;
      if (cand.status === 'pending') {
        const rule = matchRule(merchant);
        cand.suggest = { rawId: raw.id, merchant, cat: rule ? rule.c : '', sub: rule ? rule.s : '' };
      } else { cand.rawId = raw.id; cand.merchant = cand.merchant || merchant; }
      continue;
    }
    const e = entryFromRaw(raw);
    db.entries.push(e);
    raw.linkedEntryId = e.id;
    res.added++;
    if (e.status === 'done') res.auto++;
  }
  save();
  out.innerHTML = `<div class="card" style="gap:8px"><b>${res.read}건을 읽었어요</b>
    <ul class="result-list">
      <li>퀵 기록과 짝 맞춤: ${res.matched}건 ${res.matched ? '(회상에서 확인)' : ''}</li>
      <li>새 지출로 추가: ${res.added}건 (자동 분류 ${res.auto}건)</li>
      <li>이체·카드대금이라 제외: ${res.excluded}건</li>
      <li>이미 올린 내역(중복): ${res.dup}건</li>
      ${res.skipped ? `<li>입금 등 지출이 아닌 줄 건너뜀: ${res.skipped}줄</li>` : ''}
    </ul>
    <button type="button" class="btn btn-primary" data-act="close">확인</button></div>`;
  render();
}

// ---------- 백업 ----------
function exportBackup() {
  const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `퀵가계부_백업_${ymd(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function restoreBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.entries) || !Array.isArray(d.raws)) throw new Error('형식 오류');
    if (!confirm(`백업의 기록 ${d.entries.length}건으로 바꿀까요? 지금 기록은 사라져요.`)) return;
    const base = freshDB();
    db = Object.assign(base, d, { settings: Object.assign(base.settings, d.settings || {}) });
    save(); render(); toast('백업을 불러왔어요');
  } catch (e) { toast('백업 파일이 아니에요'); }
}

// =========================================================
// 그리기 + 클릭 처리
// =========================================================
function render() {
  const v = $('#view');
  const views = { record: viewRecord, recall: viewRecall, history: viewHistory, summary: viewSummary, settings: viewSettings };
  v.innerHTML = views[ui.tab]();
  if (ui.tab === 'history') updateHistory();
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const n = pendingList().length;
  const badge = $('#badge');
  badge.hidden = !n; badge.textContent = n;
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) {
    if (ev.target.id === 'modal') closeModal();
    return;
  }
  const act = el.dataset.act, v = el.dataset.v;
  switch (act) {
    case 'tab':
      if (ui.tab !== el.dataset.tab) { ui.fresh = null; window.scrollTo(0, 0); }
      if (el.dataset.tab === 'recall' && ui.tab !== 'recall') { ui.rDone = 0; ui.skipped = []; ui.rCurrent = null; }
      ui.tab = el.dataset.tab; render(); break;
    case 'key': pressKey(v); render(); break;
    case 'cat': pickCat(el.dataset.scope, v); render(); break;
    case 'sub': ui.pick[el.dataset.scope].sub = v; ui.pick[el.dataset.scope].open = null; render(); break;
    case 'saveQuick': saveQuick(); break;
    case 'voice': startVoice(); break;
    case 'sgYes': {
      const e = recallQueue()[0];
      ui.rDecision = 'yes';
      if (e && e.suggest) {
        if (e.suggest.cat) ui.pick.rcl = { cat: e.suggest.cat, sub: e.suggest.sub || null, open: null };
        if (!ui.rMemo) ui.rMemo = e.suggest.merchant || '';
      }
      render(); break;
    }
    case 'sgNo': ui.rDecision = 'no'; render(); break;
    case 'rSave': { const p = ui.pick.rcl; if (p.cat) finishRecall(p.cat, p.sub); break; }
    case 'rForget': finishRecall('미분류', ''); break;
    case 'rLater': {
      const q = recallQueue();
      if (q.length < 2) { toast('남은 기록이 이것뿐이에요'); break; }
      ui.skipped = ui.skipped.filter((id) => id !== q[0].id).concat([q[0].id]);
      ui.rCurrent = null; render(); break;
    }
    case 'month': {
      const [y, m] = ui.month.split('-').map(Number);
      ui.month = ymOf(new Date(y, m - 1 + Number(el.dataset.d), 1)); render(); break;
    }
    case 'hCat': ui.hCat = v; render(); break;
    case 'hAcc': ui.hAcc = v; render(); break;
    case 'sOpen': ui.sOpen = ui.sOpen === v ? null : v; render(); break;
    case 'edit': openEdit(el.dataset.id); break;
    case 'saveEdit': saveEdit(el.dataset.id); break;
    case 'delEntry': deleteEntry(el.dataset.id); break;
    case 'close': closeModal(); break;
    case 'import': openImport(); break;
    case 'doImport': doImport(); break;
    case 'addAcc': {
      const name = $('#newAcc').value.trim();
      if (name && !db.settings.accounts.includes(name)) { db.settings.accounts.push(name); save(); }
      render(); break;
    }
    case 'delAcc': db.settings.accounts = db.settings.accounts.filter((a) => a !== v); save(); render(); break;
    case 'addWord': {
      const w = $('#newWord').value.trim();
      if (w && !db.settings.excludeWords.includes(w)) { db.settings.excludeWords.push(w); save(); }
      render(); break;
    }
    case 'delWord': db.settings.excludeWords = db.settings.excludeWords.filter((w) => w !== v); save(); render(); break;
    case 'addRule': {
      const k = $('#newRuleK').value.trim();
      const [c, s] = $('#newRuleC').value.split('|');
      if (!k) { toast('가맹점 단어를 적어주세요'); break; }
      learnRule(k, c, s); save(); render(); toast(`"${k}" → ${c}${s ? ' › ' + s : ''} 규칙 추가`); break;
    }
    case 'delRule': db.rules = db.rules.filter((r) => r.k !== v); save(); render(); break;
    case 'export': exportBackup(); break;
    case 'wipe':
      if (confirm('모든 기록과 설정을 지울까요? 되돌릴 수 없어요.')) { db = freshDB(); save(); render(); toast('모두 지웠어요'); }
      break;
  }
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.id === 'impAcc') { $('#impNewWrap').hidden = el.value !== '__new'; return; }
  const k = el.dataset.change;
  if (k === 'account') { ui.account = el.value; }
  else if (k === 'loc') { db.settings.useLocation = el.checked; save(); }
  else if (k === 'restore' && el.files[0]) restoreBackup(el.files[0]);
});
document.addEventListener('input', (ev) => {
  const k = ev.target.dataset.input;
  if (k === 'rMemo') ui.rMemo = ev.target.value;
  else if (k === 'q') { ui.q = ev.target.value; updateHistory(); }
});

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
