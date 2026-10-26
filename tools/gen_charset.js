// 生成 GB2312 一级(3755字)/二级(3008字)字表数据文件
// 输出: js/charset-data.js (window.CHARSET = { l1, l2, all })
const fs = require('fs');
const path = require('path');

function zoneChars(hiStart, hiEnd) {
  const dec = new TextDecoder('gbk');
  const chars = [];
  for (let hi = hiStart; hi <= hiEnd; hi++) {
    for (let lo = 0xA1; lo <= 0xFE; lo++) {
      try {
        const s = dec.decode(new Uint8Array([hi, lo]));
        if (s && s.length === 1) {
          const code = s.codePointAt(0);
          if (code >= 0x4E00 && code <= 0x9FFF) { chars.push(s); continue; }
        }
        throw new Error('skip');
      } catch (e) { /* 非汉字码位跳过 */ }
    }
  }
  return chars;
}

const l1 = zoneChars(0xB0, 0xD7);
const l2 = zoneChars(0xD8, 0xF7);
if (l1.length !== 3755) { console.error('level1=' + l1.length + ' != 3755'); process.exit(1); }
if (l2.length !== 3008) { console.error('level2=' + l2.length + ' != 3008'); process.exit(1); }
const all = l1.concat(l2);
if (new Set(all).size !== 6763) { console.error('dedup count != 6763'); process.exit(1); }

const out = path.join(__dirname, '..', 'js', 'charset-data.js');
const js = '// 自动生成：GB2312 一级字表(3755字,按拼音排序) + 二级字表(3008字,按部首笔画排序)\n' +
  '// 由 tools/gen_charset.js 生成，请勿手工修改\n' +
  'window.CHARSET = {\n' +
  '  l1: "' + l1.join('') + '",\n' +
  '  l2: "' + l2.join('') + '",\n' +
  '  all: "' + all.join('') + '"\n' +
  '};\n';
fs.writeFileSync(out, js);
console.log('level1:', l1.length, 'level2:', l2.length, 'total:', all.length);
console.log('sample l1:', l1.slice(0, 24).join(''));
console.log('sample l2:', l2.slice(0, 24).join(''));
