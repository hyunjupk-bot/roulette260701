/**
 * 기후시계(Climate Clock) 상단 띠 - Google 슬라이드용 Apps Script
 *
 * 사용법
 *  1) 슬라이드 열기 → 확장 프로그램 → Apps Script → 이 코드 전체를 붙여넣고 저장
 *  2) 함수 선택 창에서 setupClimateClock 실행 (최초 1회, 권한 허용)
 *     → 마스터(모든 슬라이드 공통 배경)에 띠가 생기고, 1분 트리거가 등록됩니다.
 *  3) 이후에는 자동. 즉시 갱신하고 싶으면 updateClimateClock 실행.
 *  4) 제거: removeClimateClock 실행.
 *
 * 계산 방식 (기후시계 공식 데이터 사용)
 *  - 사선  : 남은 시간 = carbon_deadline_1.timestamp - 현재
 *  - 생명선: 재생에너지 % = initial + rate × (현재 - timestamp 이후 경과 초)
 */

var API_URL = 'https://api.climateclock.world/v2/clock.json';
var TAG = 'CC_';                       // 마스터 도형 식별용 접두어
var BAND_H = 34;                       // 상단 띠 높이(pt)
var TICKER_H = 16;                     // 하단 티커 높이(pt)

// 하단 티커 문구 (분마다 하나씩 순환). 원하는 문구로 자유롭게 수정하세요.
var TICKER = [
  '동물 이동 통로 설치로 차량-동물 충돌 사고 91% 감소',
  '재활용 유리, 사라져가는 해안선 복원의 잠재적 새로운 도구로 주목받아',
  '유럽 전기차 판매량 9월 70% 증가, 시장 점유율 약 30% 기록',
  '아마존 주민들에게 #적시에행동하세요'
];

/** 최초 1회: 띠 생성 + 1분 트리거 등록 */
function setupClimateClock() {
  removeClimateClock();
  buildBand_();
  ScriptApp.newTrigger('updateClimateClock').timeBased().everyMinutes(1).create();
  updateClimateClock();
}

/** 1분마다 실행: 값 계산 후 텍스트 갱신 */
function updateClimateClock() {
  var cfg = loadConfig_();
  var now = new Date();

  // 사선: 남은 시간
  var diffSec = Math.max(0, Math.floor((new Date(cfg.deadline) - now) / 1000));
  var years = Math.floor(diffSec / 31536000);            // 365일
  var days = Math.floor((diffSec % 31536000) / 86400);
  var hours = Math.floor((diffSec % 86400) / 3600);
  var mins = Math.floor((diffSec % 3600) / 60);
  var deadlineText = years + '년 ' + days + '일 ' + pad_(hours) + ':' + pad_(mins);

  // 생명선: 재생에너지 %
  var elapsed = (now - new Date(cfg.renewTimestamp)) / 1000;
  var pct = cfg.renewInitial + cfg.renewRate * elapsed;
  var pctText = Math.min(pct, 100).toFixed(2) + '%';

  var ticker = TICKER[Math.floor(now.getTime() / 60000) % TICKER.length];

  setText_('DEADLINE', deadlineText);
  setText_('RENEW', pctText);
  setText_('TICKER', ticker);
}

/** 제거: 트리거 + 마스터 도형 삭제 */
function removeClimateClock() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'updateClimateClock') ScriptApp.deleteTrigger(t);
  });
  SlidesApp.getActivePresentation().getMasters().forEach(function (m) {
    m.getShapes().forEach(function (s) {
      if (s.getTitle().indexOf(TAG) === 0) s.remove();
    });
  });
}

// ---------- 내부 함수 ----------

function loadConfig_() {
  var props = PropertiesService.getScriptProperties();
  try {
    var res = UrlFetchApp.fetch(API_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var m = JSON.parse(res.getContentText()).data.modules;
      var cfg = {
        deadline: m.carbon_deadline_1.timestamp,
        renewInitial: m.renewables_1.initial,
        renewTimestamp: m.renewables_1.timestamp,
        renewRate: m.renewables_1.rate
      };
      props.setProperty('cfg', JSON.stringify(cfg));   // 실패 대비 캐시
      return cfg;
    }
  } catch (e) { /* 아래 캐시 사용 */ }
  var cached = props.getProperty('cfg');
  if (!cached) throw new Error('기후시계 데이터를 불러오지 못했습니다.');
  return JSON.parse(cached);
}

function buildBand_() {
  var pres = SlidesApp.getActivePresentation();
  var W = pres.getPageWidth();
  var H = pres.getPageHeight();
  var half = W / 2;

  pres.getMasters().forEach(function (master) {
    // 검정 배경 바
    box_(master, 'BG', 0, 0, W, BAND_H, '#000000');
    // 사선(빨강)
    box_(master, 'DEADLINE_BOX', 0, 0, half, BAND_H, '#E8191F');
    label_(master, 'DEADLINE_LABEL', '사선  지구 온난화를 1.5℃로 제한할 시간이 얼마 남지 않았습니다.', 0, 0, half, 12, '#E8191F', '#FFFFFF', 7);
    text_(master, 'DEADLINE', '', 6, 12, half - 12, 22, 17, '#FFFFFF');
    // 생명선(파랑)
    box_(master, 'RENEW_BOX', half, 0, W - half, BAND_H, '#5BB8E0');
    label_(master, 'RENEW_LABEL', '생명선  전 세계 재생에너지', half, 0, W - half, 12, '#5BB8E0', '#000000', 7);
    text_(master, 'RENEW', '', half + 6, 12, W - half - 12, 22, 17, '#000000');
    // 하단 티커 (띠 바로 아래)
    box_(master, 'TICKER_BOX', 0, BAND_H, W, TICKER_H, '#000000');
    text_(master, 'TICKER', '', 6, BAND_H, W - 12, TICKER_H, 8, '#5BB8E0');
  });
}

function box_(master, name, x, y, w, h, color) {
  var s = master.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  s.setTitle(TAG + name);
  s.getFill().setSolidFill(color);
  s.getBorder().setTransparent();
  return s;
}

function label_(master, name, str, x, y, w, h, fill, fg, size) {
  var s = master.insertShape(SlidesApp.ShapeType.TEXT_BOX, x, y, w, h);
  s.setTitle(TAG + name);
  s.getText().setText(str);
  s.getText().getTextStyle().setFontSize(size).setForegroundColor(fg).setBold(true);
  return s;
}

function text_(master, name, str, x, y, w, h, size, fg) {
  var s = master.insertShape(SlidesApp.ShapeType.TEXT_BOX, x, y, w, h);
  s.setTitle(TAG + name);
  s.getText().setText(str || ' ');
  s.getText().getTextStyle().setFontSize(size).setForegroundColor(fg).setBold(true);
  s.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  return s;
}

function setText_(name, str) {
  SlidesApp.getActivePresentation().getMasters().forEach(function (m) {
    m.getShapes().forEach(function (s) {
      if (s.getTitle() === TAG + name) s.getText().setText(str);
    });
  });
}

function pad_(n) { return (n < 10 ? '0' : '') + n; }
