import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stringsFile = path.join(ROOT, 'js', 'strings.js');
let content = fs.readFileSync(stringsFile, 'utf8');
const initialContent = content;

const feature3ExportsMap = {
  en: "2 free exports/mo (Sheets, CSV, or Excel) for classes up to 25 attendees",
  es: "2 exportaciones gratuitas/mes (Sheets, CSV o Excel) para clases de hasta 25 asistentes",
  pt: "2 exportações gratuitas/mês (Sheets, CSV ou Excel) para turmas de até 25 participantes",
  hi: "25 उपस्थित लोगों तक की कक्षाओं के लिए प्रति माह 2 निःशुल्क निर्यात (Sheets, CSV या Excel)",
  ta: "25 பங்கேற்பாளர்கள் வரையிலான வகுப்புகளுக்கு மாதத்திற்கு 2 இலவச ஏற்றுமதிகள் (Sheets, CSV அல்லது Excel)",
  te: "25 మంది హాజరైన వారి వరకు తరగతులకు నెలకు 2 ఉచిత ఎగుమతులు (Sheets, CSV లేదా Excel)",
  bn: "২৫ জন পর্যন্ত উপস্থিতির ক্লাসের জন্য প্রতি মাসে ২টি বিনামূল্যের এক্সপোর্ট (Sheets, CSV বা Excel)",
  ur: "25 شرکاء تک کی کلاسوں کے لیے ماہانہ 2 مفت برآمدات (Sheets، CSV یا Excel)",
  tl: "2 libreng export/buwan (Sheets, CSV, o Excel) para sa mga klaseng hanggang 25 dadalo",
  ms: "2 eksport percuma/bulan (Sheets, CSV, atau Excel) untuk kelas sehingga 25 peserta",
  id: "2 ekspor gratis/bulan (Sheets, CSV, atau Excel) untuk kelas hingga 25 peserta",
  vi: "2 lần xuất miễn phí/tháng (Sheets, CSV hoặc Excel) cho lớp học tối đa 25 người",
  fr: "2 exports gratuits/mois (Sheets, CSV ou Excel) pour les cours jusqu'à 25 participants",
  de: "2 kostenlose Exporte/Monat (Sheets, CSV oder Excel) für Klassen bis zu 25 Teilnehmer",
  it: "2 esportazioni gratuite/mese (Sheets, CSV o Excel) per classi fino a 25 partecipanti",
  nl: "2 gratis exports/maand (Sheets, CSV of Excel) voor klassen tot 25 deelnemers",
  pl: "2 darmowe eksporty/miesiąc (Sheets, CSV lub Excel) dla grup do 25 uczestników",
  ro: "2 exporturi gratuite/lună (Sheets, CSV sau Excel) pentru grupe de până la 25 participanți",
  ru: "2 бесплатных экспорта в месяц (Sheets, CSV или Excel) для групп до 25 участников",
  uk: "2 безкоштовні експорти на місяць (Sheets, CSV або Excel) для груп до 25 учасників",
  tr: "25 katılımcıya kadar sınıflar için ayda 2 ücretsiz dışa aktarım (Sheets, CSV veya Excel)",
  th: "ส่งออกฟรี 2 ครั้ง/เดือน (Sheets, CSV หรือ Excel) สำหรับชั้นเรียนสูงสุด 25 คน",
  ar: "تصديران مجانيان شهريًا (Sheets أو CSV أو Excel) للفصول التي تضم حتى 25 مشاركًا",
  ko: "최대 25명 수업에 월 2회 무료 내보내기 (Sheets, CSV 또는 Excel)",
  zh: "最多 25 位參與者的課堂每月享有 2 次免費匯出（Sheets、CSV 或 Excel）",
  'zh-CN': "最多 25 位参与者的课堂每月享有 2 次免费导出（Sheets、CSV 或 Excel）",
  ja: "最大25名のクラス向けに月2回の無料エクスポート（Sheets、CSV、またはExcel）",
  he: "2 ייצואים חינם בחודש (Sheets, CSV או Excel) לכיתות עד 25 משתתפים",
  mr: "25 उपस्थितांपर्यंतच्या वर्गांसाठी दरमहा 2 मोफत निर्यात (Sheets, CSV किंवा Excel)",
  sv: "2 gratis exporter/månad (Sheets, CSV eller Excel) för klasser upp till 25 deltagare",
  cs: "2 bezplatné exporty/měsíc (Sheets, CSV nebo Excel) pro třídy až do 25 účastníků",
  da: "2 gratis eksporter/måned (Sheets, CSV eller Excel) for hold op til 25 deltagere",
  fi: "2 ilmaista vientiä/kk (Sheets, CSV tai Excel) enintään 25 osallistujan ryhmille",
  hu: "Havi 2 ingyenes exportálás (Sheets, CSV vagy Excel) legfeljebb 25 fős csoportoknak",
  so: "2 dhoofin oo bilaash ah bishii (Sheets, CSV, ama Excel) fasallada ilaa 25 ka qaybgalayaal",
  sw: "Uhamishaji 2 wa bure kwa mwezi (Sheets, CSV, au Excel) kwa madarasa hadi washiriki 25",
  am: "እስከ 25 ተሳታፊዎች ላሏቸው ክፍሎች በወር 2 ነፃ ኤክስፖርቶች (Sheets፣ CSV ወይም Excel)",
  si: "සහභාගිවන්නන් 25ක් දක්වා පන්ති සඳහා මසකට නොමිලේ අපනයන 2ක් (Sheets, CSV හෝ Excel)",
  el: "2 δωρεάν εξαγωγές/μήνα (Sheets, CSV ή Excel) για τάξεις έως 25 συμμετέχοντες",
  no: "2 gratis eksporter/måned (Sheets, CSV eller Excel) for klasser opptil 25 deltakere",
  ca: "2 exportacions gratuïtes/mes (Sheets, CSV o Excel) per a classes de fins a 25 assistents",
  ne: "२५ सहभागीहरू सम्मका कक्षाहरूका लागि प्रति महिना २ निःशुल्क निर्यात (Sheets, CSV वा Excel)",
  ml: "25 പങ്കെടുത്തവർ വരെയുള്ള ക്ലാസുകൾക്ക് പ്രതിമാസം 2 സൗജന്യ എക്സ്പോർട്ടുകൾ (Sheets, CSV അല്ലെങ്കിൽ Excel)",
  mn: "25 хүртэлх оролцогчтой ангиудад сард 2 үнэгүй экспорт (Sheets, CSV эсвэл Excel)",
  kn: "25 ಪಾಲ್ಗೊಳ್ಳುವವರವರೆಗಿನ ತರಗತಿಗಳಿಗೆ ತಿಂಗಳಿಗೆ 2 ಉಚಿತ ರಫ್ತುಗಳು (Sheets, CSV, ಅಥವಾ Excel)",
  gu: "25 સહભાગીઓ સુધીના વર્ગો માટે દર મહિને 2 મફત નિકાસ (Sheets, CSV, અથવા Excel)",
  pa: "25 ਹਾਜ਼ਰੀਨ ਤੱਕ ਦੀਆਂ ਕਲਾਸਾਂ ਲਈ ਮਹੀਨੇ ਵਿੱਚ 2 ਮੁਫ਼ਤ ਐਕਸਪੋਰਟ (Sheets, CSV, ਜਾਂ Excel)",
  kk: "25 қатысушыға дейінгі топтар үшін айына 2 тегін экспорт (Sheets, CSV немесе Excel)",
  lv: "2 bezmaksas eksporti mēnesī (Sheets, CSV vai Excel) nodarbībām līdz 25 dalībniekiem",
  lt: "2 nemokami eksportai per mėnesį (Sheets, CSV arba Excel) klasėms iki 25 dalyvių",
  lo: "ສົ່ງອອກຟຣີ 2 ຄັ້ງ/ເດືອນ (Sheets, CSV ຫຼື Excel) ສຳລັບຫ້ອງຮຽນສູງສຸດ 25 ຄົນ",
  my: "တက်ရောက်သူ ၂၅ ဦးအထိ အတန်းများအတွက် တစ်လလျှင် ၂ ကြိမ် အခမဲ့ ထုတ်ယူခွင့် (Sheets, CSV သို့မဟုတ် Excel)",
  km: "ការនាំចេញឥតគិតថ្លៃ 2 ដង/ខែ (Sheets, CSV ឬ Excel) សម្រាប់ថ្នាក់រហូតដល់ 25 នាក់",
  ceb: "2 ka libreng export/buwan (Sheets, CSV, o Excel) para sa mga klase nga hangtod sa 25 ka nanambong",
  bg: "2 безплатни експорта на месец (Sheets, CSV или Excel) за класове до 25 участници",
  hr: "2 besplatna izvoza mjesečno (Sheets, CSV ili Excel) za razrede do 25 sudionika",
  sr: "2 бесплатна извоза месечно (Sheets, CSV или Excel) за одељења до 25 присутних",
  sk: "2 bezplatné exporty mesačne (Sheets, CSV alebo Excel) pre triedy do 25 účastníkov",
  sl: "2 brezplačna izvoza na mesec (Sheets, CSV ali Excel) za razrede do 25 udeležencev",
  af: "2 gratis uitvoere/mnd (Sheets, CSV of Excel) vir klasse tot 25 deelnemers"
};

// 1. Update pricing.cmp5Title, pricing.cmp5Body, lp2_proof_4_title, lp2_feat_8_title, lp2_feat_8_body
// Replace 42/44 -> 60, ४२/४४ -> ६०, and Burmese ၄၄ -> ၆၀ in their values
const targetKeys = ['pricing.cmp5Title', 'pricing.cmp5Body', 'lp2_proof_4_title', 'lp2_feat_8_title', 'lp2_feat_8_body'];

for (const k of targetKeys) {
  const regex = new RegExp(`(["']${k.replace('.', '\\.')}["']:\\s*["'])([^"']+)(["'])`, 'g');
  content = content.replace(regex, (match, prefix, val, suffix) => {
    let updated = val
      .replace(/\b44\b/g, '60')
      .replace(/\b42\b/g, '60')
      .replace(/४४/g, '६०')
      .replace(/४२/g, '६०')
      .replace(/၄၄/g, '၆၀')
      .replace(/\b30\b/g, '60');
    return `${prefix}${updated}${suffix}`;
  });
}

// Update empty.demo (10 demo students -> 25 demo students, including Burmese ၁၀ -> ၂၅)
const demoRegex = /(["']empty\.demo["']:\s*["'])([^"']+)(["'])/g;
content = content.replace(demoRegex, (match, prefix, val, suffix) => {
  let updated = val
    .replace(/\b10\b/g, '25')
    .replace(/१०/g, '२५')
    .replace(/১০/g, '২৫')
    .replace(/၁၀/g, '၂၅');
  return `${prefix}${updated}${suffix}`;
});

const cmp6Overrides = {
  ml: "പ്രതിവർഷം $80–$100 SaaS ബില്ലുകളില്ല — Lifetime Pro-യ്ക്ക് ഒരിക്കൽ മാത്രം $9.99 പണമടയ്ക്കുക, അല്ലെങ്കിൽ ഡിപ്പാർട്ട്‌മെന്റ് ($59/yr) / ഇൻസ്റ്റിറ്റ്യൂഷൻ ($149/yr) വാർഷിക പ്ലാനുകൾ ഉപയോഗിച്ച് നിങ്ങളുടെ സ്കൂൾ ഡൊമെയ്ൻ മുഴുവൻ കവർ ചെയ്യുക.",
  mn: "Жилийн $80–$100 SaaS төлбөргүй — Lifetime Pro багцыг $9.99-өөр нэг удаа төлөөд ав, эсвэл Тэнхим ($59/жил) болон Байгууллагын ($149/жил) жилийн багцаар сургуулийнхаа бүх домэйныг хамруулаарай."
};

const fineprintOverrides = {
  en: "Prices are in USD and exclusive of any applicable local sales taxes. Free tier includes 2 free exports/mo (Sheets, CSV, or Excel) for classes up to 25 attendees. Lifetime passes are pay-once with no recurring charges. Payments are securely processed by Stripe and billed by Kinetic Helix LLC, operator of Attendance Tracker.",
  ml: "വിലകൾ USD-ലാണ്, പ്രാദേശിക നികുതികൾ ബാധകമായേക്കാം. സൗജന്യ പ്ലാനിൽ 25 പങ്കെടുത്തവർ വരെയുള്ള ക്ലാസുകൾക്ക് പ്രതിമാസം 2 സൗജന്യ എക്സ്പോർട്ടുകൾ (Sheets, CSV അല്ലെങ്കിൽ Excel) ഉൾപ്പെടുന്നു. ലൈഫ് ടൈം പാസുകൾ ഒറ്റത്തവണ പേയ്‌മെന്റാണ്. പേയ്‌മെന്റുകൾ Stripe വഴി സുരക്ഷിതമായി പ്രോസസ്സ് ചെയ്യുന്നു.",
  mn: "Үнэ нь ам. доллараар бөгөөд орон нутгийн татварыг оруулаагүй болно. Үнэгүй багцад 25 хүртэлх оролцогчтой ангиудад сард 2 үнэгүй экспорт (Sheets, CSV эсвэл Excel) багтана. Насан туршийн эрх нь давтагдах төлбөргүй нэг удаагийн худалдан авалт юм. Төлбөрийг Stripe найдвартай гүйцэтгэнэ.",
  th: "ราคาแสดงเป็นดอลลาร์สหรัฐ (USD) ไม่รวมภาษีขายในท้องถิ่น แพ็กเกจฟรีรวมการส่งออกฟรี 2 ครั้ง/เดือน (Sheets, CSV หรือ Excel) สำหรับชั้นเรียนสูงสุด 25 คน แพ็กเกจตลอดชีพจ่ายครั้งเดียวไม่มีการเรียกเก็บเงินซ้ำ การชำระเงินดำเนินการอย่างปลอดภัยโดย Stripe และเรียกเก็บเงินโดย Kinetic Helix LLC ผู้ให้บริการ Attendance Tracker",
  zh: "價格均以美元 (USD) 計價，不含任何適用的當地銷售稅。免費版包含最多 25 位參與者的課堂每月 2 次免費匯出（Sheets、CSV 或 Excel）。終身通行證為一次性付款，無經常性費用。付款由 Stripe 安全處理，並由 Attendance Tracker 營運商 Kinetic Helix LLC 開立帳單。",
  "zh-CN": "价格均以美元 (USD) 计价，不含任何适用的当地销售税。免费版包含最多 25 位参与者的课堂每月 2 次免费导出（Sheets、CSV 或 Excel）。终身通行证为一次性付款，无经常性费用。付款由 Stripe 安全处理，并由 Attendance Tracker 运营商 Kinetic Helix LLC 开具账单。",
  ja: "価格は米ドル（USD）表記で、適用される現地の消費税等は含まれていません。無料プランには最大25名のクラス向けに月2回の無料エクスポート（Sheets、CSV、またはExcel）が含まれます。買い切りプランは1回限りの支払いで、継続課金はありません。決済はStripeによって安全に処理され、Attendance Trackerの運営会社であるKinetic Helix LLCから請求されます。",
  ur: "قیمتیں امریکی ڈالر (USD) میں ہیں اور ان میں کوئی مقامی سیلز ٹیکس شامل نہیں ہے۔ مفت پلان میں 25 شرکاء تک کی کلاسوں کے لیے ماہانہ 2 مفت برآمدات (Sheets، CSV یا Excel) شامل ہیں۔ لائف ٹائم پاسز صرف ایک بار ادائیگی کے ساتھ ہیں اور کوئی بار بار چارجز نہیں ہیں۔ ادائیگیاں Stripe کے ذریعے محفوظ طریقے سے پراسیس کی جاتی ہیں اور Kinetic Helix LLC کی طرف سے بل کی جاتی ہیں۔",
  am: "ዋጋዎች በአሜሪካ ዶላር (USD) ሲሆኑ የአካባቢ የሽያጭ ታክስን አያካትቱም። ነፃው እቅድ እስከ 25 ተሳታፊዎች ላሏቸው ክፍሎች በወር 2 ነፃ ኤክስፖርቶች (Sheets፣ CSV ወይም Excel) ያካትታል። የዕድሜ ልክ ፈቃዶች ያለ ተደጋጋሚ ክፍያ አንድ ጊዜ ብቻ የሚከፈሉ ናቸው። ክፍያዎች በStripe በኩል ደህንነቱ በተጠበቀ ሁኔታ ይፈጸማሉ።"
};

// 2. Update pricing.feature3Exports, pricing.fineprintBody, pricing.cmp6Body, and lp2_plan_free_body for each locale
for (const [loc, newStr] of Object.entries(feature3ExportsMap)) {
  const locRegex = new RegExp(`^[ \\t]*(?:"${loc}"|'${loc}'|${loc}):\\s*\\{`, 'm');
  const locMatch = locRegex.exec(content);
  if (!locMatch) {
    console.error(`Locale ${loc} not found!`);
    continue;
  }
  const locIdx = locMatch.index;
  const nextCloseIdx = content.indexOf('\n    },', locIdx);
  const nextLocIdx = nextCloseIdx !== -1 ? nextCloseIdx : content.indexOf('\n    }', locIdx);
  let block = content.slice(locIdx, nextLocIdx);

  // pricing.feature3Exports
  const keyRegex = /["']pricing\.feature3Exports["']:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;
  const oldFeatureMatch = block.match(keyRegex);
  const oldFeatureStr = oldFeatureMatch ? (oldFeatureMatch[1] ?? oldFeatureMatch[2]) : null;
  if (oldFeatureMatch) {
    block = block.replace(keyRegex, `"pricing.feature3Exports": ${JSON.stringify(newStr)}`);
  }

  // pricing.cmp6Body override for ml/mn
  if (cmp6Overrides[loc]) {
    const cmp6Regex = /["']pricing\.cmp6Body["']:\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/;
    if (cmp6Regex.test(block)) {
      block = block.replace(cmp6Regex, `"pricing.cmp6Body": ${JSON.stringify(cmp6Overrides[loc])}`);
    }
  }

  // pricing.fineprintBody: ensure accurate quota without false unlimited claims or duplicate injections
  const fineprintRegex = /["']pricing\.fineprintBody["']:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;
  const fpMatch = block.match(fineprintRegex);
  if (fpMatch) {
    let fpVal = (fpMatch[1] ?? fpMatch[2]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (fineprintOverrides[loc]) {
      fpVal = fineprintOverrides[loc];
    } else if (oldFeatureStr && fpVal.includes(`(${oldFeatureStr})`)) {
      fpVal = fpVal.replace(`(${oldFeatureStr})`, `(${newStr})`);
    } else if (oldFeatureStr && fpVal.includes(oldFeatureStr)) {
      fpVal = fpVal.replace(oldFeatureStr, newStr);
    } else if (fpVal.includes('(.xlsx)')) {
      if (fpVal.includes('। ')) {
        const parts = fpVal.split('। ');
        const idx = parts.findIndex(p => p.includes('(.xlsx)'));
        if (idx !== -1) parts[idx] = newStr;
        fpVal = parts.join('। ');
      } else if (fpVal.includes('។ ')) {
        const parts = fpVal.split('។ ');
        const idx = parts.findIndex(p => p.includes('(.xlsx)'));
        if (idx !== -1) parts[idx] = newStr;
        fpVal = parts.join('។ ');
      } else if (fpVal.includes('။ ')) {
        const parts = fpVal.split('။ ');
        const idx = parts.findIndex(p => p.includes('(.xlsx)'));
        if (idx !== -1) parts[idx] = newStr;
        fpVal = parts.join('။ ');
      } else {
        const parts = fpVal.split('. ');
        const idx = parts.findIndex(p => p.includes('(.xlsx)'));
        if (idx !== -1) parts[idx] = newStr;
        fpVal = parts.join('. ');
      }
    } else if (!fpVal.includes(newStr) && !fpVal.includes('Sheets')) {
      const firstDot = fpVal.indexOf('।') !== -1 ? fpVal.indexOf('।') : fpVal.indexOf('.');
      if (firstDot !== -1) {
        fpVal = fpVal.slice(0, firstDot + 1) + ` (${newStr}) ` + fpVal.slice(firstDot + 1).trim();
      }
    }
    block = block.replace(fineprintRegex, `"pricing.fineprintBody": ${JSON.stringify(fpVal)}`);
  }

  // lp2_plan_free_body: ensure accurate free quota
  const planFreeRegex = /["']lp2_plan_free_body["']:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/;
  const pfMatch = block.match(planFreeRegex);
  if (pfMatch) {
    let pfVal = (pfMatch[1] ?? pfMatch[2]);
    if (/\b5\b/.test(pfVal)) {
      if (loc === 'en') {
        pfVal = "Live roster, 2 free exports/mo (Sheets, CSV, or Excel, up to 25 attendees). No credit card.";
      } else {
        pfVal = pfVal.replace(/\b5\b/g, '2');
      }
      block = block.replace(planFreeRegex, `"lp2_plan_free_body": ${JSON.stringify(pfVal)}`);
    }
  }

  content = content.slice(0, locIdx) + block + content.slice(nextLocIdx);
}

if (content !== initialContent) {
  fs.writeFileSync(stringsFile, content, 'utf8');
  console.log('Successfully harmonized strings across all 60 locales in js/strings.js');
} else {
  console.log('js/strings.js is already harmonized.');
}
