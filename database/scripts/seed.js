// DEV ONLY: fills both databases with demo data.
//   PostgreSQL: accounts, suppliers, medicines, stock lots      MongoDB: patients, notifications
// Run after `npm run db:reset`:   npm run db:seed
//
// IMPORTANT - about the medicine data (see docs/data-sources.md):
//  * A hand-written demo list of medicines commonly sold in Thai pharmacies. It is NOT an import of
//    Thai Medicines Terminology (TMT) and brand names are examples only.
//  * Every row is saved with data_status = 'UNVERIFIED'. Legal categories, ข.ย.11 flags and the
//    counselling text come from secondary sources and standard references; they were not checked
//    against Thai FDA registered labels. This is course-project data, not clinical advice.
//  * Prices: only the rows marked "observed" below were read from a shop page on 14 Nov 2026.
//    All other prices are estimates. Lot costs are simply 60% of the sell price.
//  * Not seeded on purpose: single-ingredient tramadol, pseudoephedrine, codeine cough syrups and
//    oral steroids (legal status changed or not sellable in a pharmacy).
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../../backend/connections/pg');
const { connectMongo, closeMongo } = require('../../backend/connections/mongo');
const { DRUG_CLASSES } = require('../../backend/config/contract');

const ACCOUNTS = [
  { username: 'admin', password: 'admin123', full_name: 'Demo Admin', role: 'ADMIN' },
  { username: 'pharmacist', password: 'pharma123', full_name: 'Demo Pharmacist', role: 'PHARMACIST' },
  { username: 'assistant', password: 'assist123', full_name: 'Demo Assistant', role: 'ASSISTANT' },
];

// Invented wholesalers (no real company is implied).
const SUPPLIERS = [
  { name: 'Siam Pharma Supply', phone: '02-111-2222', address: 'Bangkok' },
  { name: 'Northern Drug Wholesale', phone: '053-333-4444', address: 'Chiang Mai' },
  { name: 'Southern Medical Distribution', phone: '074-555-6666', address: 'Songkhla' },
];

const HH = 'HOUSEHOLD';
const PK = 'PACKAGED_NON_DANGEROUS';
const DD = 'DANGEROUS';
const NSAID_WARN = 'ห้ามใช้ในผู้ที่มีแผลในกระเพาะอาหาร โรคไตหรือหัวใจรุนแรง หรือเคยหอบจากยากลุ่ม NSAIDs หลีกเลี่ยงเมื่อตั้งครรภ์ตั้งแต่ 20 สัปดาห์';
const ASU = 'ใช้เมื่อมีข้อบ่งชี้ของการติดเชื้อแบคทีเรียเท่านั้น กินให้ครบตามที่เภสัชกรแนะนำ';

// key, generic (lowercase, '+' joins ingredients), brand, strength, form, class, legal,
// base unit, units per pack, sell price per base unit, reorder level, extra info
const M = (key, generic, brand, strength, form, cls, legal, unit, perPack, price, reorder, x = {}) => ({
  key, generic, brand, strength, form, cls, legal, unit, perPack, price, reorder, ...x,
});

const MEDICINES = [
  // --- pain and fever
  M('tylenol', 'paracetamol', 'Tylenol', '500 mg', 'tablet', 'PARACETAMOL', HH, 'tablet', 10, 1.8, 200, // observed: Watsons TH, 18 THB / 10 tablets
    { ind: 'ลดไข้ บรรเทาปวด', se: 'พบน้อย อาจคลื่นไส้', warn: 'กินเกินขนาดเป็นพิษต่อตับ ระวังการกินยาที่มี paracetamol ซ้ำซ้อน', max: '4 g (ไม่เกิน 8 เม็ด 500 mg)' }),
  M('sara', 'paracetamol', 'Sara', '500 mg', 'tablet', 'PARACETAMOL', HH, 'tablet', 10, 1.5, 200,
    { ind: 'ลดไข้ บรรเทาปวด', warn: 'กินเกินขนาดเป็นพิษต่อตับ ระวังการกินยาที่มี paracetamol ซ้ำซ้อน', max: '4 g (ไม่เกิน 8 เม็ด 500 mg)' }),
  M('paracap', 'paracetamol', 'Paracap', '500 mg', 'tablet', 'PARACETAMOL', HH, 'tablet', 10, 1, 200, // observed: 10 THB / 10 tablets (marketplace listing)
    { ind: 'ลดไข้ บรรเทาปวด', warn: 'กินเกินขนาดเป็นพิษต่อตับ ระวังการกินยาที่มี paracetamol ซ้ำซ้อน', max: '4 g (ไม่เกิน 8 เม็ด 500 mg)' }),
  M('parasyr', 'paracetamol', 'Tempra', '120 mg/5 ml', 'syrup', 'PARACETAMOL', HH, 'bottle', 12, 35, 6,
    { ind: 'ลดไข้ในเด็ก', warn: 'คำนวณขนาดยาตามน้ำหนักตัวเด็ก', store: 'ห้ามแช่แข็ง' }),
  M('ibu400', 'ibuprofen', 'Nurofen', '400 mg', 'tablet', 'NSAIDS', DD, 'tablet', 10, 2.5, 100,
    { ind: 'บรรเทาปวด ลดอักเสบ ลดไข้', se: 'ปวดท้อง อาหารไม่ย่อย', warn: NSAID_WARN, max: '1.2 g เมื่อใช้เอง' }),
  M('mefenamic', 'mefenamic acid', 'Ponstan', '500 mg', 'tablet', 'NSAIDS', DD, 'tablet', 10, 3, 80,
    { ind: 'บรรเทาปวดประจำเดือน ปวดกล้ามเนื้อ', se: 'ปวดท้อง ท้องเสีย', warn: NSAID_WARN, max: '1.5 g ใช้ไม่เกิน 7 วัน' }),
  M('diclo25', 'diclofenac', 'Voltaren', '25 mg', 'tablet', 'NSAIDS', DD, 'tablet', 10, 2.5, 80,
    { ind: 'บรรเทาปวด ลดอักเสบ', se: 'ปวดท้อง', warn: `${NSAID_WARN} ห้ามใช้ในโรคหัวใจขาดเลือดหรือเคยเป็นโรคหลอดเลือดสมอง`, max: '150 mg' }),
  M('aspirin81', 'aspirin', 'Aspent', '81 mg', 'tablet', 'NSAIDS', DD, 'tablet', 10, 1.5, 60,
    { ind: 'ต้านเกล็ดเลือด (ตามแพทย์สั่ง)', se: 'อาหารไม่ย่อย', warn: 'ห้ามใช้ในเด็กอายุต่ำกว่า 16 ปี ระวังเลือดออกในทางเดินอาหาร', max: '75-325 mg สำหรับต้านเกล็ดเลือด' }),
  M('counterpain', 'methyl salicylate+menthol', 'Counterpain', '30 g', 'cream', 'NSAIDS', PK, 'tube', 12, 80, 4,
    { ind: 'ทาบรรเทาปวดกล้ามเนื้อ', warn: 'ห้ามทาบริเวณแผลเปิด ผู้ที่แพ้ salicylate ควรหลีกเลี่ยง' }),

  // --- cold, allergy, cough
  M('decolgen', 'paracetamol+phenylephrine+chlorpheniramine', 'Decolgen', '500 mg+10 mg+2 mg', 'tablet', 'ANTIHISTAMINES', DD, 'tablet', 4, 2.5, 80,
    { ind: 'บรรเทาอาการหวัด คัดจมูก', se: 'ง่วงซึม', warn: 'มี paracetamol อยู่แล้ว ห้ามกินร่วมกับยา paracetamol อื่น' }),
  M('cpm4', 'chlorpheniramine', null, '4 mg', 'tablet', 'ANTIHISTAMINES', HH, 'tablet', 10, 0.5, 100,
    { ind: 'บรรเทาอาการแพ้ น้ำมูกไหล', se: 'ง่วงซึม ปากแห้ง', warn: 'ระวังในผู้สูงอายุ ต้อหิน ต่อมลูกหมากโต ห้ามขับรถ', max: '24 mg' }),
  M('cpmsyr', 'chlorpheniramine', null, '2 mg/5 ml', 'syrup', 'ANTIHISTAMINES', DD, 'bottle', 12, 30, 6,
    { khy11: true, ind: 'บรรเทาอาการแพ้ในเด็ก', se: 'ง่วงซึม', warn: 'ยาน้ำแก้แพ้รุ่นแรก ต้องลงบัญชี ข.ย.11' }),
  M('cetirizine', 'cetirizine', 'Zyrtec', '10 mg', 'tablet', 'ANTIHISTAMINES', DD, 'tablet', 10, 3, 100,
    { ind: 'บรรเทาอาการแพ้ ลมพิษ', se: 'ง่วงเล็กน้อย', max: '10 mg (ลดขนาดในผู้ป่วยไตบกพร่อง)' }),
  M('loratadine', 'loratadine', 'Clarityne', '10 mg', 'tablet', 'ANTIHISTAMINES', DD, 'tablet', 10, 4, 100,
    { ind: 'บรรเทาอาการแพ้ ไม่ค่อยง่วง', se: 'ปวดศีรษะ', max: '10 mg' }),
  M('fexo180', 'fexofenadine', 'Telfast', '180 mg', 'tablet', 'ANTIHISTAMINES', DD, 'tablet', 10, 9, 50, { ind: 'บรรเทาอาการแพ้ ลมพิษ' }),
  M('bromhexine', 'bromhexine', 'Bisolvon', '8 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 2.5, 60,
    { ind: 'ละลายเสมหะ', se: 'ปวดท้อง', max: '48 mg' }),
  M('ambroxol', 'ambroxol', 'Mucosolvan', '30 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 2.5, 60, { ind: 'ละลายเสมหะ' }),
  M('carbocisteine', 'carbocisteine', 'Flemex', '375 mg', 'capsule', 'OTHER', DD, 'capsule', 10, 3, 60, { ind: 'ละลายเสมหะ' }),
  M('dxm15', 'dextromethorphan', 'Romilar', '15 mg', 'tablet', 'ANTITUSSIVES', DD, 'tablet', 10, 2, 60,
    { khy11: true, maxQty: 20, ind: 'บรรเทาอาการไอแห้ง', se: 'มึนงง ง่วง', warn: 'ห้ามใช้ร่วมกับยากลุ่ม MAOI ขายได้ไม่เกิน 20 เม็ดต่อครั้ง และต้องลงบัญชี ข.ย.11', max: '120 mg' }),
  M('brownmix', 'brown mixture', 'GPO', '60 ml', 'mixture', 'OTHER', HH, 'bottle', 12, 28, 6, { ind: 'บรรเทาอาการไอ ขับเสมหะ', store: 'เก็บพ้นแสง' }),

  // --- stomach and bowel
  M('antacid', 'aluminium hydroxide+magnesium hydroxide', 'Antacil', '240 ml', 'suspension', 'ANTACIDS', HH, 'bottle', 12, 55, 6,
    { ind: 'ลดกรด บรรเทาแสบร้อนกลางอก', se: 'ท้องผูกหรือท้องเสีย', warn: 'เว้นระยะ 2-4 ชั่วโมงจากยาปฏิชีวนะกลุ่ม fluoroquinolone ยาธาตุเหล็ก และ azithromycin', store: 'ห้ามแช่แข็ง' }),
  M('airx', 'simethicone', 'Air-X', '80 mg', 'chewable tablet', 'OTHER', HH, 'tablet', 10, 2, 100, // observed: Makro, 179 THB / 100 tablets (bulk)
    { ind: 'ขับลม แก้ท้องอืด' }),
  M('omeprazole', 'omeprazole', 'Miracid', '20 mg', 'capsule', 'PPIS', DD, 'capsule', 10, 3.5, 100,
    { ind: 'ลดการหลั่งกรด รักษากรดไหลย้อน', se: 'ปวดศีรษะ ท้องเสีย', max: '40 mg', store: 'เก็บในที่แห้ง' }),
  M('domperidone', 'domperidone', 'Motilium', '10 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 2.5, 60,
    { ind: 'แก้คลื่นไส้ อาเจียน', se: 'ปากแห้ง ปวดศีรษะ', warn: 'ห้ามใช้ในผู้ที่หัวใจเต้นผิดจังหวะหรือตับบกพร่องปานกลางถึงรุนแรง', max: '30 mg ใช้ไม่เกิน 7 วัน' }),
  M('dimen', 'dimenhydrinate', 'Dramamine', '50 mg', 'tablet', 'ANTIHISTAMINES', HH, 'tablet', 10, 1.5, 50, { ind: 'แก้เมารถ เมาเรือ', se: 'ง่วงซึม' }),
  M('ors', 'oral rehydration salts', 'ORS GPO', '1 sachet', 'powder', 'ANTIDIARRHEALS', HH, 'sachet', 50, 7, 50,
    { ind: 'ทดแทนการสูญเสียน้ำจากท้องเสีย', warn: 'ผสมน้ำตามปริมาณที่ฉลากกำหนด', store: 'ผสมแล้วใช้ให้หมดภายใน 24 ชั่วโมง' }),
  M('smecta', 'diosmectite', 'Smecta', '3 g', 'powder', 'ANTIDIARRHEALS', PK, 'sachet', 10, 15, 20, { ind: 'บรรเทาท้องเสีย' }),
  M('loperamide', 'loperamide', 'Imodium', '2 mg', 'capsule', 'ANTIDIARRHEALS', DD, 'capsule', 10, 2.5, 60,
    { ind: 'หยุดถ่ายเหลวแบบเฉียบพลัน', se: 'ท้องผูก', warn: 'ห้ามใช้เมื่อท้องเสียมีไข้หรือถ่ายเป็นมูกเลือด ห้ามใช้ในเด็กเล็ก', max: '16 mg' }),
  M('senna', 'senna', null, '7.5 mg', 'tablet', 'OTHER', HH, 'tablet', 10, 1.5, 50, { ind: 'ยาระบาย แก้ท้องผูก' }),
  M('mebendazole', 'mebendazole', 'Fugacar', '500 mg', 'tablet', 'OTHER', HH, 'tablet', 1, 25, 10, { ind: 'ถ่ายพยาธิ' }),

  // --- antibiotics (dangerous drugs: pharmacist only)
  M('amoxy', 'amoxicillin', 'Amoxy', '500 mg', 'capsule', 'PENICILLINS', DD, 'capsule', 10, 4, 100,
    { ind: `ยาปฏิชีวนะ ${ASU}`, se: 'ท้องเสีย ผื่น', warn: 'ห้ามใช้ในผู้ที่แพ้ penicillin', max: '1.5-3 g' }),
  M('amoxsyr', 'amoxicillin', 'Ibiamox', '250 mg/5 ml', 'dry syrup', 'PENICILLINS', DD, 'bottle', 12, 70, 6,
    { ind: `ยาปฏิชีวนะสำหรับเด็ก ${ASU}`, warn: 'ห้ามใช้ในผู้ที่แพ้ penicillin', store: 'ผสมน้ำแล้วเก็บในตู้เย็น ทิ้งหลัง 7 วัน' }),
  M('augmentin', 'amoxicillin+clavulanic acid', 'Augmentin', '875 mg+125 mg', 'tablet', 'PENICILLINS', DD, 'tablet', 14, 22, 28,
    { ind: `ยาปฏิชีวนะ ${ASU}`, se: 'ท้องเสีย', warn: 'ห้ามใช้ในผู้ที่แพ้ penicillin หรือเคยตับอักเสบจากยานี้', store: 'เก็บต่ำกว่า 25 °C ในแผงเดิม' }),
  M('dicloxa', 'dicloxacillin', 'Diclocil', '500 mg', 'capsule', 'PENICILLINS', DD, 'capsule', 10, 4.5, 60,
    { ind: `ยาปฏิชีวนะสำหรับแผลติดเชื้อที่ผิวหนัง ${ASU}`, warn: 'ห้ามใช้ในผู้ที่แพ้ penicillin', max: '2 g' }),
  M('cefalexin', 'cefalexin', 'Keflex', '500 mg', 'capsule', 'CEPHALOSPORINS', DD, 'capsule', 10, 5, 50,
    { lowStock: true, ind: `ยาปฏิชีวนะ ${ASU}`, se: 'ท้องเสีย', warn: 'ห้ามใช้ในผู้ที่แพ้ cephalosporin ระวังในผู้ที่แพ้ amoxicillin หรือ ampicillin', max: '4 g' }),
  M('roxithro', 'roxithromycin', 'Rulid', '150 mg', 'tablet', 'MACROLIDES', DD, 'tablet', 10, 7.5, 40,
    { ind: `ยาปฏิชีวนะ ${ASU}`, warn: 'ระวังการใช้ร่วมกับ simvastatin และ warfarin', max: '300 mg' }),
  M('azithro', 'azithromycin', 'Zithromax', '250 mg', 'tablet', 'MACROLIDES', DD, 'tablet', 6, 18, 24,
    { ind: `ยาปฏิชีวนะ ${ASU}`, se: 'ท้องเสีย', warn: 'ระวังในผู้ที่หัวใจเต้นผิดจังหวะ', max: '500 mg' }),
  M('norflox', 'norfloxacin', 'Lexinor', '400 mg', 'tablet', 'FLUOROQUINOLONES', DD, 'tablet', 10, 3.5, 40,
    { ind: `ยาปฏิชีวนะสำหรับทางเดินปัสสาวะ ${ASU}`, se: 'คลื่นไส้ มึนงง', warn: 'เสี่ยงเอ็นอักเสบหรือเอ็นฉีก หลีกเลี่ยงในหญิงตั้งครรภ์ ให้นมบุตร และเด็ก เว้นระยะจากยาลดกรดและธาตุเหล็ก 2 ชั่วโมง', max: '800 mg', store: 'เก็บพ้นแสง' }),
  M('doxy', 'doxycycline', null, '100 mg', 'capsule', 'TETRACYCLINES', DD, 'capsule', 10, 3, 40,
    { ind: `ยาปฏิชีวนะ ${ASU}`, warn: 'ห้ามใช้ในหญิงตั้งครรภ์และเด็กอายุต่ำกว่า 8 ปี' }),
  M('cotrim', 'sulfamethoxazole+trimethoprim', 'Bactrim', '400 mg+80 mg', 'tablet', 'SULFONAMIDES', DD, 'tablet', 10, 2.5, 40,
    { ind: `ยาปฏิชีวนะ ${ASU}`, warn: 'ห้ามใช้ในผู้ที่แพ้ยากลุ่มซัลฟา มีรายงานผื่นแพ้ยารุนแรง (SJS/TEN)' }),
  M('metro', 'metronidazole', 'Flagyl', '400 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 2.5, 40,
    { ind: `ยาฆ่าเชื้อแบคทีเรียและโปรโตซัว ${ASU}`, se: 'ลิ้นรับรสโลหะ', warn: 'ห้ามดื่มแอลกอฮอล์ระหว่างใช้ยาและอีก 48 ชั่วโมงหลังหยุดยา', max: '2 g' }),

  // --- eye, skin and external use
  M('chlornicol', 'chloramphenicol', 'Chlornicol', '0.5% 5 ml', 'eye drops', 'OTHER', DD, 'bottle', 12, 45, 6,
    { ind: 'ยาหยอดตาฆ่าเชื้อ', store: 'เก็บในตู้เย็น 2-8 °C ทิ้งหลังเปิดใช้ 30 วัน' }),
  M('tears', 'hypromellose', 'Tears Naturale', '15 ml', 'eye drops', 'OTHER', PK, 'bottle', 12, 110, 4, { ind: 'น้ำตาเทียม บรรเทาตาแห้ง', store: 'ทิ้งหลังเปิดใช้ 30 วัน' }),
  M('betadine', 'povidone-iodine', 'Betadine', '10% 15 ml', 'solution', 'OTHER', HH, 'bottle', 12, 55, 6, // observed: Watsons TH, 55 THB
    { ind: 'ใส่แผลสด ฆ่าเชื้อ', warn: 'ห้ามใช้ในผู้ที่แพ้ไอโอดีน', store: 'เก็บพ้นแสง' }),
  M('silveral', 'silver sulfadiazine', 'Silveral', '1% 25 g', 'cream', 'SULFONAMIDES', DD, 'tube', 12, 95, 4,
    { ind: 'ทาแผลไฟไหม้ น้ำร้อนลวก', warn: 'ห้ามใช้ในผู้ที่แพ้ยากลุ่มซัลฟา' }),
  M('calamine', 'calamine', null, '60 ml', 'lotion', 'OTHER', HH, 'bottle', 12, 30, 6, { ind: 'ทาแก้ผดผื่นคัน', store: 'เขย่าขวดก่อนใช้' }),
  M('kenalog', 'triamcinolone', 'Kenalog in Orabase', '0.1% 5 g', 'oral paste', 'CORTICOSTEROIDS', DD, 'tube', 12, 60, 4, { ind: 'ป้ายแผลร้อนใน' }),
  M('canesten', 'clotrimazole', 'Canesten', '1% 15 g', 'cream', 'OTHER', DD, 'tube', 12, 55, 4, { ind: 'ทารักษาเชื้อราที่ผิวหนัง', se: 'แสบ ระคายเคือง' }),

  // --- vitamins and minerals
  M('ferrous', 'ferrous sulfate', null, '200 mg', 'tablet', 'OTHER', HH, 'tablet', 100, 0.45, 100,
    { ind: 'เสริมธาตุเหล็ก', se: 'ท้องผูก อุจจาระสีดำ', warn: 'เว้นระยะจากยาลดกรดและยากลุ่ม fluoroquinolone' }),
  M('bco', 'vitamin b complex', 'B-Co GPO', '1 tablet', 'tablet', 'VITAMINS', HH, 'tablet', 100, 0.5, 100, { ind: 'เสริมวิตามินบีรวม', store: 'เก็บพ้นแสง' }),
  M('vitc', 'vitamin c', null, '500 mg', 'tablet', 'VITAMINS', HH, 'tablet', 100, 1.5, 100, { ind: 'เสริมวิตามินซี', store: 'เก็บในที่แห้ง' }),

  // --- chronic disease refills (legal category not confirmed: see docs/data-sources.md)
  M('amlodipine', 'amlodipine', 'Norvasc', '5 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 3, 60,
    { ind: 'ลดความดันโลหิต (ผู้ป่วยที่แพทย์วินิจฉัยแล้ว)', se: 'ข้อเท้าบวม หน้าแดง', warn: 'เมื่อใช้ร่วมกับ simvastatin ให้ simvastatin ไม่เกิน 20 mg ต่อวัน', max: '10 mg' }),
  M('metformin', 'metformin', 'Glucophage', '500 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 1.5, 60,
    { ind: 'ลดน้ำตาลในเลือด (ผู้ป่วยที่แพทย์วินิจฉัยแล้ว)', se: 'ปวดท้อง คลื่นไส้', warn: 'ห้ามใช้เมื่อไตบกพร่องรุนแรง (eGFR ต่ำกว่า 30)', max: '2.55 g' }),
  M('simvastatin', 'simvastatin', 'Zocor', '20 mg', 'tablet', 'OTHER', DD, 'tablet', 10, 2.5, 60,
    { ind: 'ลดไขมันในเลือด (ผู้ป่วยที่แพทย์วินิจฉัยแล้ว)', se: 'ปวดกล้ามเนื้อ', warn: 'ห้ามใช้ร่วมกับ clarithromycin, erythromycin และยาต้านเชื้อรากลุ่ม azole ห้ามใช้ในหญิงตั้งครรภ์', max: '40 mg' }),
];

function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

// One or two normal lots per medicine, plus a few special lots that make the demo cases visible.
function buildLots() {
  const lots = [];
  MEDICINES.forEach((m, i) => {
    const packs = (n) => Math.max(1, Math.ceil(n / m.perPack)) * m.perPack;
    if (m.lowStock) {
      // Below its reorder level on purpose: asking for more than this triggers the rollback demo.
      lots.push({ key: m.key, no: 'A009', expiry: isoDate(64), received: isoDate(-40), qty: 5, supplier: 2, status: 'ACTIVE' });
      return;
    }
    lots.push({
      key: m.key, no: `A${String(i + 1).padStart(3, '0')}`, expiry: isoDate(260 + ((i * 37) % 420)),
      received: isoDate(-(20 + ((i * 13) % 150))), qty: packs(m.reorder * 1.5), supplier: i % 3, status: 'ACTIVE',
    });
    if (i % 2 === 0) {
      lots.push({
        key: m.key, no: `B${String(i + 1).padStart(3, '0')}`, expiry: isoDate(500 + ((i * 29) % 300)),
        received: isoDate(-(5 + (i % 15))), qty: packs(m.reorder), supplier: (i + 1) % 3, status: 'ACTIVE',
      });
    }
  });
  lots.push(
    // FEFO demo: Tylenol has a small lot that expires soon, so a sale of 60 spans two lots.
    { key: 'tylenol', no: 'X-SOON', expiry: isoDate(25), received: isoDate(-300), qty: 50, supplier: 0, status: 'ACTIVE' },
    // Expired but still on the shelf: must never be sold, and the stock scan reports them.
    { key: 'amoxy', no: 'X-OLD', expiry: isoDate(-60), received: isoDate(-700), qty: 30, supplier: 1, status: 'ACTIVE' },
    { key: 'ibu400', no: 'X-EXP', expiry: isoDate(-20), received: isoDate(-650), qty: 30, supplier: 0, status: 'ACTIVE' },
    // Near expiry (inside the 180-day window).
    { key: 'cetirizine', no: 'N-120', expiry: isoDate(120), received: isoDate(-400), qty: 40, supplier: 0, status: 'ACTIVE' },
    { key: 'ors', no: 'N-090', expiry: isoDate(90), received: isoDate(-380), qty: 50, supplier: 2, status: 'ACTIVE' },
    // Quarantined: in stock but not sellable until the pharmacist releases it.
    { key: 'omeprazole', no: 'Q-HOLD', expiry: isoDate(600), received: isoDate(-3), qty: 60, supplier: 1, status: 'QUARANTINED' }
  );
  return lots;
}

// Invented people. allergen format: see docs/data-contract.md.
const A = (level, code, extra = {}) => ({ level, code, ...extra });
const PATIENTS = [
  { name: 'สมใจ ใจดี', phone: '081-000-0001', note: 'ผู้ป่วยแจ้งว่าเคยมีผื่นลมพิษหลังกิน amoxicillin เมื่อปี 2567',
    allergies: [A('CLASS', 'PENICILLINS', { criticality: 'HIGH', verification_status: 'CONFIRMED', manifestations: ['ผื่นลมพิษ'], severity: 'MODERATE' }),
      A('INGREDIENT', 'ibuprofen', { criticality: 'LOW', manifestations: ['ปากบวม'], severity: 'MILD' })] },
  { name: 'วิชัย รักษ์ไทย', phone: '081-000-0002',
    allergies: [A('CLASS', 'SULFONAMIDES', { criticality: 'HIGH', verification_status: 'CONFIRMED', manifestations: ['ผื่นแพ้ยารุนแรง (SJS)'], severity: 'SEVERE' })] },
  { name: 'มาลี ศรีสุข', phone: '081-000-0003', allergies: [] },
  { name: 'ประเสริฐ ทองดี', phone: '081-000-0004',
    allergies: [A('CLASS', 'NSAIDS', { criticality: 'HIGH', verification_status: 'CONFIRMED', manifestations: ['หอบ หายใจลำบาก'], severity: 'SEVERE' })] },
  { name: 'กนกวรรณ แสงทอง', phone: '081-000-0005',
    allergies: [A('INGREDIENT', 'amoxicillin', { criticality: 'HIGH', verification_status: 'CONFIRMED', manifestations: ['ผื่นทั้งตัว'], severity: 'MODERATE' })] },
  { name: 'ธนากร วงศ์ใหญ่', phone: '081-000-0006', allergies: [] },
  { name: 'สุนิสา พรหมมา', phone: '081-000-0007',
    allergies: [A('INGREDIENT', 'chlorpheniramine', { type: 'INTOLERANCE', criticality: 'LOW', manifestations: ['ง่วงมากจนทำงานไม่ได้'], severity: 'MILD' })] },
  { name: 'อนุชา บุญมี', phone: '081-000-0008',
    allergies: [A('CLASS', 'FLUOROQUINOLONES', { criticality: 'HIGH', manifestations: ['เอ็นร้อยหวายอักเสบ'], severity: 'MODERATE' })] },
  { name: 'ปิยะนุช จันทร์เพ็ญ', phone: '081-000-0009', allergies: [] },
  { name: 'สมชาย มั่นคง', phone: '081-000-0010', allergies: [A('CLASS', 'CEPHALOSPORINS', { criticality: 'UNABLE_TO_ASSESS', manifestations: ['ผื่น'] })] },
  { name: 'จิราพร อินทร์แก้ว', phone: '081-000-0011',
    // REFUTED: tested and found not allergic, so the sale check ignores it.
    allergies: [A('CLASS', 'PENICILLINS', { criticality: 'LOW', verification_status: 'REFUTED', manifestations: ['คลื่นไส้'] })] },
  { name: 'ณัฐพล สายสุวรรณ', phone: '081-000-0012', allergies: [] },
];

function patientDocs(recordedBy) {
  const now = new Date();
  return PATIENTS.map((p, i) => ({
    patient_code: `P${String(i + 1).padStart(5, '0')}`,
    name: p.name,
    phone: p.phone,
    allergies: p.allergies.map((a) => {
      const reaction = { manifestations: a.manifestations || [] };
      if (a.severity) reaction.severity = a.severity;
      return {
        allergen: { level: a.level, code: a.code, display: a.level === 'CLASS' ? DRUG_CLASSES[a.code].label : a.code },
        type: a.type || 'ALLERGY',
        criticality: a.criticality || 'UNABLE_TO_ASSESS',
        verification_status: a.verification_status || 'UNCONFIRMED',
        reactions: [reaction],
        recorded_by: recordedBy,
        recorded_at: now,
      };
    }),
    notes: p.note ? [{ author_staff_id: recordedBy, ts: now, text: p.note, tags: [] }] : [],
    created_at: now,
    updated_at: now,
  }));
}

async function main() {
  const existing = await pool.query('SELECT COUNT(*)::int AS n FROM staff');
  if (existing.rows[0].n > 0) {
    throw new Error('The database already has data. Run `npm run db:reset` first, then `npm run db:seed`.');
  }
  const db = await connectMongo();
  const lots = buildLots();

  const staffIds = await withTransaction(async (c) => {
    const ids = [];
    for (const a of ACCOUNTS) {
      const hash = await bcrypt.hash(a.password, 10);
      const r = await c.query(
        'INSERT INTO staff (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING staff_id',
        [a.username, hash, a.full_name, a.role]
      );
      ids.push(r.rows[0].staff_id);
    }

    const supplierIds = [];
    for (const s of SUPPLIERS) {
      const r = await c.query('INSERT INTO suppliers (name, phone, address) VALUES ($1,$2,$3) RETURNING supplier_id', [s.name, s.phone, s.address]);
      supplierIds.push(r.rows[0].supplier_id);
    }

    const medicineIds = {};
    const byKey = {};
    for (const m of MEDICINES) {
      const r = await c.query(
        `INSERT INTO medicines
           (generic_name, brand_name, strength, dosage_form, drug_class, legal_category, requires_prescription,
            requires_khy11, base_unit, units_per_pack, sell_price, reorder_level,
            indication, side_effects, warnings, max_daily_dose, storage_note, max_qty_per_sale, data_status)
         VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'UNVERIFIED') RETURNING medicine_id`,
        [m.generic, m.brand, m.strength, m.form, m.cls, m.legal, !!m.khy11, m.unit, m.perPack, m.price, m.reorder,
          m.ind || null, m.se || null, m.warn || null, m.max || null, m.store || null, m.maxQty || null]
      );
      medicineIds[m.key] = r.rows[0].medicine_id;
      byKey[m.key] = m;
    }

    for (const l of lots) {
      const m = byKey[l.key];
      const mfg = new Date(l.expiry);
      mfg.setFullYear(mfg.getFullYear() - 2);
      await c.query(
        `INSERT INTO stock_lots
           (medicine_id, supplier_id, lot_number, mfg_date, expiry_date, received_date,
            qty_received, qty_on_hand, unit_cost, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9)`,
        [medicineIds[l.key], supplierIds[l.supplier], l.no, mfg.toISOString().slice(0, 10), l.expiry,
          l.received, l.qty, Number((m.price * 0.6).toFixed(2)), l.status]
      );
    }
    return ids;
  });

  const patients = patientDocs(staffIds[1]);
  await db.collection('patient_notes').insertMany(patients);
  const now = new Date();
  await db.collection('notifications').insertMany([
    { recipient_role: 'PHARMACIST', message: 'ยินดีต้อนรับ: กด "ตรวจสต็อกตอนนี้" ในหน้าแจ้งเตือนสต็อกเพื่อดูล็อตหมดอายุและสต็อกต่ำ', is_read: false, created_at: now },
    { recipient_role: 'ASSISTANT', message: 'ยาอันตรายต้องให้เภสัชกรเป็นผู้ขาย ผู้ช่วยขายได้เฉพาะยาสามัญประจำบ้านและยาบรรจุเสร็จ', is_read: false, created_at: now },
    { recipient_role: 'ADMIN', message: 'ข้อมูลยาเป็นข้อมูลตัวอย่างที่ยังไม่ได้ตรวจกับทะเบียน อย. (ดู docs/data-sources.md)', is_read: false, created_at: now },
  ]);

  console.log(`Seeded PostgreSQL: ${ACCOUNTS.length} staff, ${SUPPLIERS.length} suppliers, ${MEDICINES.length} medicines, ${lots.length} lots.`);
  console.log(`Seeded MongoDB: ${patients.length} patients, 3 notifications.`);
  console.log('\nDemo accounts (local development only):');
  ACCOUNTS.forEach((a) => console.log(`  ${a.role.padEnd(10)} ${a.username} / ${a.password}`));
}

main()
  .catch((err) => {
    console.error('db:seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await closeMongo().catch(() => {});
  });
