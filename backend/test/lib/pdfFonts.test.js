// Per-script PDF fonts: run splitting is pure; install() is exercised against a
// real PDFKit doc, using the committed base Noto Sans as a stand-in "face" so
// the routing logic runs without the build-time font downloads.
const path = require('path');
const PDFDocument = require('pdfkit');
const pdfFonts = require('../../src/lib/pdfFonts');

const BASE = path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Regular.ttf');

function render(fn, faces) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve({ doc, pdf: Buffer.concat(chunks) }));
    doc.registerFont('body', BASE);
    doc.font('body');
    pdfFonts.install(doc, 'body', 'ja', faces);
    fn(doc);
    doc.end();
  });
}

describe('pdfFonts — script detection', () => {
  test('scriptOf classifies letters; digits, spaces and punctuation are neutral', () => {
    expect(pdfFonts.scriptOf('a')).toBe('base');
    expect(pdfFonts.scriptOf('Ж')).toBe('base');
    expect(pdfFonts.scriptOf('ह')).toBe('devanagari');
    expect(pdfFonts.scriptOf('م')).toBe('arabic');
    expect(pdfFonts.scriptOf('ש')).toBe('hebrew');
    expect(pdfFonts.scriptOf('ก')).toBe('thai');
    expect(pdfFonts.scriptOf('あ')).toBe('kana');
    expect(pdfFonts.scriptOf('한')).toBe('hangul');
    expect(pdfFonts.scriptOf('学')).toBe('han');
    expect(pdfFonts.scriptOf(' ')).toBeNull();
    expect(pdfFonts.scriptOf('7')).toBeNull();
  });

  test('splitRuns groups same-script text and attaches neutrals', () => {
    expect(pdfFonts.splitRuns('Certificate — राहुल शर्मा (2026)')).toEqual([['base', 'Certificate — '], ['devanagari', 'राहुल शर्मा (2026)']]);
    expect(pdfFonts.splitRuns('123 مرحبا')).toEqual([['arabic', '123 مرحبا']]);
    expect(pdfFonts.splitRuns('  ')).toEqual([['base', '  ']]);
    expect(pdfFonts.splitRuns('')).toEqual([]);
    // Kanji inside Japanese / Hanja inside Korean use that language's face.
    expect(pdfFonts.splitRuns('山田 たろう')).toEqual([['kana', '山田 たろう']]);
    expect(pdfFonts.splitRuns('Kim 金 민준')).toEqual([['base', 'Kim '], ['hangul', '金 민준']]);
    expect(pdfFonts.splitRuns('数学')).toEqual([['han', '数学']]);
  });

  test('faceFor picks the CJK face by script, then by language for Han', () => {
    expect(pdfFonts.faceFor('kana', 'zh')).toBe('cjk-jp');
    expect(pdfFonts.faceFor('hangul', 'en')).toBe('cjk-kr');
    expect(pdfFonts.faceFor('han', 'zh')).toBe('cjk-tc');
    expect(pdfFonts.faceFor('han', 'zh-CN')).toBe('cjk-sc');
    expect(pdfFonts.faceFor('han', 'ja')).toBe('cjk-jp');
    expect(pdfFonts.faceFor('han', 'de')).toBe('cjk-sc');
    expect(pdfFonts.faceFor('arabic', 'en')).toBe('arabic');
  });

  test('availableFaces only lists fonts present on disk', () => {
    expect(pdfFonts.availableFaces(path.join(__dirname, 'no-such-dir'))).toEqual({});
  });
});

describe('pdfFonts — install', () => {
  const faces = { devanagari: BASE, arabic: BASE, 'cjk-jp': BASE };

  test('routes runs to registered faces (single, mixed, centered, wrapped, RTL)', async () => {
    const used = [];
    const { pdf } = await render((doc) => {
      const font = doc.font.bind(doc);
      doc.font = (name, ...a) => { used.push(name); return font(name, ...a); };
      doc.text('राहुल', 50, 50);                                         // single run
      doc.text('Math — 数学 たろう', 50, 80, { width: 300, align: 'center' }); // mixed, centered
      doc.text('Name — राहुल', 50, 110, { width: 300, align: 'right' });     // mixed, right
      doc.text('Mixed — राहुल '.repeat(40), 50, 140, { width: 100, align: 'center' }); // too wide → continued
      doc.text('Left — راهول', { width: 300 });                            // mixed, flowing
      doc.text('محمد أحمد', 50, 400);                                      // RTL single run
      doc.text(42);                                                        // numbers
      doc.text('plain latin');                                             // base only
      expect(doc.widthOfString('राहुल abc')).toBeGreaterThan(0);
      expect(doc.widthOfString('abc')).toBeGreaterThan(0);
    }, faces);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    expect(used).toEqual(expect.arrayContaining(['face-devanagari', 'face-cjk-jp', 'face-arabic', 'body']));
  });

  test('scripts without a downloaded face fall back to the base font', async () => {
    const used = [];
    await render((doc) => {
      const font = doc.font.bind(doc);
      doc.font = (name, ...a) => { used.push(name); return font(name, ...a); };
      doc.text('สมชาย', 50, 50);
      doc.text(undefined);
    }, {});
    expect(used.every((n) => n === 'body')).toBe(true);
  });
});
