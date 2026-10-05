import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stringsFile = path.join(ROOT, 'js', 'strings.js');
let content = fs.readFileSync(stringsFile, 'utf8');

const feature3ExportsMap = {
  en: "2 free Google Sheets cloud exports/mo + unlimited direct CSV & binary Excel (.xlsx) exports for classes up to 25 attendees",
  es: "2 exportaciones gratuitas a Google Sheets/mes + descargas ilimitadas de CSV y Excel (.xlsx) (hasta 25 asistentes)",
  pt: "2 exportações gratuitas para o Google Sheets/mês + downloads ilimitados de CSV e Excel (.xlsx) (até 25 participantes)",
  hi: "प्रति माह 2 निःशुल्क Google Sheets निर्यात + असीमित प्रत्यक्ष CSV और Excel (.xlsx) निर्यात (25 उपस्थित लोगों तक)",
  ta: "மாதத்திற்கு 2 இலவச Google Sheets ஏற்றுமதிகள் + வரம்பற்ற நேரடி CSV மற்றும் Excel (.xlsx) ஏற்றுமதிகள் (25 பங்கேற்பாளர்கள் வரை)",
  te: "నెలకు 2 ఉచిత Google Sheets ఎగుమతులు + అపరిమిత ప్రత్యక్ష CSV మరియు Excel (.xlsx) ఎగుమతులు (25 మంది హాజరైన వారి వరకు)",
  bn: "প্রতি মাসে ২টি বিনামূল্যের Google Sheets এক্সপোর্ট + সীমাহীন সরাসরি CSV ও Excel (.xlsx) এক্সপোর্ট (২৫ জন পর্যন্ত উপস্থিতি)",
  ur: "ماہانہ 2 مفت Google Sheets برآمدات + لامحدود براہ راست CSV اور Excel (.xlsx) برآمدات (25 شرکاء تک)",
  tl: "2 libreng Google Sheets export/buwan + walang limitasyong CSV at Excel (.xlsx) export (hanggang 25 dadalo)",
  ms: "2 eksport Google Sheets percuma/bulan + muat turun CSV & Excel (.xlsx) tanpa had (sehingga 25 peserta)",
  id: "2 ekspor Google Sheets gratis/bulan + ekspor langsung CSV & Excel (.xlsx) tanpa batas (hingga 25 peserta)",
  vi: "2 lần xuất Google Sheets miễn phí/tháng + xuất trực tiếp CSV & Excel (.xlsx) không giới hạn (tối đa 25 người)",
  fr: "2 exports Google Sheets gratuits/mois + téléchargements directs CSV et Excel (.xlsx) illimités (jusqu'à 25 participants)",
  de: "2 kostenlose Google Sheets-Exporte/Monat + unbegrenzte direkte CSV- & Excel-Exporte (.xlsx) (bis zu 25 Teilnehmer)",
  it: "2 esportazioni gratuite su Google Sheets/mese + download diretti di CSV ed Excel (.xlsx) illimitati (fino a 25 partecipanti)",
  nl: "2 gratis Google Sheets-exports/maand + onbeperkte directe CSV- & Excel-downloads (.xlsx) (tot 25 deelnemers)",
  pl: "2 darmowe eksporty do Google Sheets/miesiąc + nielimitowane bezpośrednie pobrania CSV i Excel (.xlsx) (do 25 uczestników)",
  ro: "2 exporturi gratuite Google Sheets/lună + descărcări directe nelimitate CSV și Excel (.xlsx) (până la 25 participanți)",
  ru: "2 бесплатных экспорта в Google Sheets в месяц + неограниченный экспорт CSV и Excel (.xlsx) (до 25 участников)",
  uk: "2 безкоштовні експорти в Google Sheets на місяць + необмежений експорт CSV та Excel (.xlsx) (до 25 учасників)",
  tr: "Ayda 2 ücretsiz Google Sheets dışa aktarımı + sınırsız doğrudan CSV ve Excel (.xlsx) dışa aktarımı (25 katılımcıya kadar)",
  th: "ส่งออก Google Sheets ฟรี 2 ครั้ง/เดือน + ส่งออก CSV และ Excel (.xlsx) ไม่จำกัด (สูงสุด 25 ผู้เข้าร่วม)",
  ar: "تصديران مجانيان إلى Google Sheets شهريًا + تنزيلات مباشرة غير محدودة لـ CSV وExcel (.xlsx) (حتى 25 مشاركًا)",
  ko: "월 2회 무료 Google Sheets 내보내기 + 무제한 직접 CSV 및 Excel (.xlsx) 내보내기 (최대 25명)",
  zh: "每月 2 次免費 Google Sheets 匯出 + 無限制直接 CSV 與 Excel (.xlsx) 下載 (最多 25 位參與者)",
  'zh-CN': "每月 2 次免费 Google Sheets 导出 + 无限制直接 CSV 和 Excel (.xlsx) 下载 (最多 25 位参与者)",
  ja: "月2回の無料Google Sheetsエクスポート + 無制限の直接CSV/Excel (.xlsx) エクスポート (最大25名)",
  he: "2 ייצואים חינם ל-Google Sheets בחודש + ייצוא ישיר של CSV ו-Excel (.xlsx) ללא הגबלה (עד 25 משתתפים)",
  mr: "दरमहा 2 मोफत Google Sheets निर्यात + अमर्यादित थेट CSV आणि Excel (.xlsx) निर्यात (25 उपस्थितांपर्यंत)",
  sv: "2 gratis Google Sheets-exporter/månad + obegränsad direkt CSV- och Excel-export (.xlsx) (upp till 25 deltagare)",
  cs: "2 bezplatné exporty do Google Sheets/měsíc + neomezený přímý export CSV a Excelu (.xlsx) (až 25 účastníků)",
  da: "2 gratis Google Sheets-eksporter/måned + ubegrænset direkte CSV- og Excel-eksport (.xlsx) (op til 25 deltagere)",
  fi: "2 ilmaista Google Sheets -vientiä/kk + rajoittamattomat suorat CSV- ja Excel-viennit (.xlsx) (enintään 25 osallistujaa)",
  hu: "2 ingyenes Google Sheets export havonta + korlátlan közvetlen CSV és Excel (.xlsx) export (legfeljebb 25 résztvevő)",
  so: "2 dhoofin Google Sheets oo bilaash ah bishii + dhoofin toos ah oo CSV & Excel (.xlsx) aan xadidnayn (ilaa 25 ka qaybgalayaal)",
  sw: "Uhamishaji 2 wa bure wa Google Sheets kwa mwezi + uhamishaji wa moja kwa moja wa CSV & Excel (.xlsx) usio na kikomo (hadi washiriki 25)",
  am: "በወር 2 ነፃ የGoogle Sheets ኤክስፖርቶች + ያልተገደበ ቀጥተኛ የCSV እና Excel (.xlsx) ኤክስፖርት (እስከ 25 ተሳታፊዎች)",
  si: "මසකට නොමිලේ Google Sheets අපනයන 2ක් + සීමාවකින් තොරව සෘජු CSV සහ Excel (.xlsx) අපනයන (සහභාගිවන්නන් 25ක් දක්වා)",
  el: "2 δωρεάν εξαγωγές Google Sheets/μήνα + απεριόριστες άμεσες εξαγωγές CSV & Excel (.xlsx) (έως 25 συμμετέχοντες)",
  no: "2 gratis Google Sheets-eksporter/måned + ubegrenset direkte CSV- og Excel-eksport (.xlsx) (opptil 25 deltakere)",
  ca: "2 exportacions gratuïtes a Google Sheets/mes + descàrregues directes il·limitades de CSV i Excel (.xlsx) (fins a 25 assistents)",
  ne: "प्रति महिना २ निःशुल्क Google Sheets निर्यात + २५ सहभागीहरू सम्मका लागि असीमित प्रत्यक्ष CSV र Excel (.xlsx) निर्यात"
};

// 1. Update pricing.cmp5Title, pricing.cmp5Body, lp2_proof_4_title, lp2_feat_8_title, lp2_feat_8_body
// Replace 30 -> 42 and ३० -> ४२ in their values
const targetKeys = ['pricing.cmp5Title', 'pricing.cmp5Body', 'lp2_proof_4_title', 'lp2_feat_8_title', 'lp2_feat_8_body'];

for (const k of targetKeys) {
  const regex = new RegExp(`("${k.replace('.', '\\.')}":\\s*")([^"]+)(")`, 'g');
  content = content.replace(regex, (match, prefix, val, suffix) => {
    let updated = val;
    if (updated.includes('30')) {
      updated = updated.replace(/\b30\b/g, '42');
    }
    if (updated.includes('३०')) {
      updated = updated.replace(/३०/g, '४२');
    }
    return `${prefix}${updated}${suffix}`;
  });
}

// 2. Update pricing.feature3Exports, pricing.fineprintBody, and lp2_plan_free_body for each locale
for (const [loc, newStr] of Object.entries(feature3ExportsMap)) {
  const locPattern = `"${loc}": {`;
  const locIdx = content.indexOf(locPattern);
  if (locIdx === -1) {
    console.error(`Locale ${loc} not found!`);
    continue;
  }
  const nextLocIdx = content.indexOf('\n    },', locIdx);
  let block = content.slice(locIdx, nextLocIdx);

  // pricing.feature3Exports
  const keyRegex = /"pricing\.feature3Exports":\s*"[^"]+"/;
  if (keyRegex.test(block)) {
    block = block.replace(keyRegex, `"pricing.feature3Exports": ${JSON.stringify(newStr)}`);
  }

  // pricing.fineprintBody: ensure free quota statement is included
  const fineprintRegex = /"pricing\.fineprintBody":\s*"([^"]+)"/;
  const fpMatch = block.match(fineprintRegex);
  if (fpMatch) {
    let fpVal = fpMatch[1];
    if (!fpVal.includes('2 free Google Sheets') && !fpVal.includes(newStr)) {
      if (loc === 'en') {
        fpVal = `Prices are in USD and exclusive of any applicable local sales taxes. Free tier includes ${newStr}. Lifetime passes are pay-once with no recurring charges. Payments are securely processed by Stripe and billed by Kinetic Helix LLC, operator of Attendance Tracker.`;
      } else {
        // Insert after first period or start
        const firstDot = fpVal.indexOf('.');
        if (firstDot !== -1) {
          fpVal = fpVal.slice(0, firstDot + 1) + ` (${newStr}) ` + fpVal.slice(firstDot + 1).trim();
        }
      }
      block = block.replace(fineprintRegex, `"pricing.fineprintBody": ${JSON.stringify(fpVal)}`);
    }
  }

  // lp2_plan_free_body: ensure accurate free quota
  const planFreeRegex = /"lp2_plan_free_body":\s*"([^"]+)"/;
  const pfMatch = block.match(planFreeRegex);
  if (pfMatch) {
    let pfVal = pfMatch[1];
    if (pfVal.includes('5') || pfVal.includes('५')) {
      if (loc === 'en') {
        pfVal = "Live roster, 2 free Google Sheets exports/mo, unlimited CSV & Excel (up to 25 attendees). No credit card.";
      } else {
        pfVal = pfVal.replace(/\b5\b/g, '2').replace(/५/g, '२');
      }
      block = block.replace(planFreeRegex, `"lp2_plan_free_body": ${JSON.stringify(pfVal)}`);
    }
  }

  content = content.slice(0, locIdx) + block + content.slice(nextLocIdx);
}

fs.writeFileSync(stringsFile, content, 'utf8');
console.log('Successfully harmonized strings in js/strings.js');
