/**
 * @jest-environment jsdom
 *
 * The page modules' date/number/duration formatters delegate to the locale-
 * aware AttStrings.fmt (js/strings.js) once it is loaded, so they follow the
 * language the user chose rather than the browser's. Without it they keep
 * their legacy English output (covered in each module's own test file).
 */

const path = require('path');
const js = (f) => require(path.join(__dirname, '..', '..', '..', 'js', f));
const strings = js('strings.js');
const utils = js('utils.js');
const history = js('history.js');
const team = js('team.js');
const share = js('share.js');

const ISO = '2026-03-03T15:04:00Z';

beforeEach(() => {
  window.AttStrings = strings;
  strings.setLocale('de');
});
afterEach(() => {
  strings.setLocale('en');
  delete window.AttStrings;
});

test('dates and percentages follow the chosen locale', () => {
  for (const mod of [history, team, share]) {
    expect(mod.fmtDate(ISO)).toBe(strings.fmt.date(ISO));
    expect(mod.fmtDate(ISO)).toMatch(/März|Mär/);
    expect(mod.fmtDate(null)).toBe('—');
    expect(mod.pct(0.875)).toBe(strings.fmt.percent(0.875));
    expect(mod.pct(0.875)).toMatch(/88\s?%/);
  }
});

test('durations use localized unit names', () => {
  for (const mod of [history, team]) {
    expect(mod.fmtDuration(80 * 60000)).toBe(strings.fmt.duration(80 * 60000));
    expect(mod.fmtDuration(0)).toBe('—');
    expect(mod.fmtMinutes(45)).toBe(strings.fmt.minutes(45));
    expect(mod.fmtMinutes(0)).toBe('—');
  }
  expect(history.fmtTime(ISO)).toBe(strings.fmt.time(ISO));
  expect(history.fmtTime('')).toBe('');
});

test('panel utils: time, durations and relative time', () => {
  const d = new Date(ISO);
  expect(utils.fmtTime(d)).toBe(strings.fmt.time(d, { hour: '2-digit', minute: '2-digit' }));
  expect(utils.fmtDurMs(30 * 1000)).toBe(strings.fmt.minutes(0)); // "< 1 Min."
  expect(utils.fmtDurMs(65 * 60000)).toBe(strings.fmt.minutes(65));
  // A just-started meeting reads "1 min" rather than "0 min".
  expect(utils.fmtDur(d, new Date(d.getTime() + 10000))).toBe(strings.fmt.minutes(1));
  expect(utils.formatRelative(new Date(Date.now() - 5 * 60000))).toBe(strings.fmt.relative(new Date(Date.now() - 5 * 60000)));
  expect(utils.formatRelative(null)).toBe('');
});
