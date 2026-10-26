/* 数据服务：笔画数据获取/缓存、拼音部首、笔画名称判定（几何分类 + cnchar 交叉校验）、结构说明、易错提示 */
(function () {
  'use strict';

  var MIRRORS = [
    'https://fastly.jsdelivr.net/npm/hanzi-writer-data@2.0.1/',
    'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/',
    'https://unpkg.com/hanzi-writer-data@2.0.1/'
  ];
  var CACHE_KEY = 'hbh.cache.v1.';
  var CACHE_IDX = 'hbh.cacheIdx';
  var CACHE_MAX = 260;
  var inflight = {};

  var hasCnchar = (typeof window.cnchar !== 'undefined') && (typeof window.cncharOrder !== 'undefined');
  if (hasCnchar) {
    try { window.cnchar.use(window.cncharOrder, window.cncharPoly, window.cncharRadical); } catch (e) { }
  }

  /* ---------------- 输入过滤 ---------------- */
  function sanitize(str) {
    return (str || '').replace(/[^\u4e00-\u9fff]/g, '');
  }

  /* ---------------- 笔画数据获取（多镜像 + localStorage LRU 缓存） ---------------- */
  function cacheGet(ch) {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY + ch) || 'null'); }
    catch (e) { return null; }
  }
  function cachePut(ch, data) {
    try {
      localStorage.setItem(CACHE_KEY + ch, JSON.stringify(data));
      var idx = JSON.parse(localStorage.getItem(CACHE_IDX) || '[]');
      idx = idx.filter(function (c) { return c !== ch; });
      idx.push(ch);
      while (idx.length > CACHE_MAX) {
        var drop = idx.shift();
        localStorage.removeItem(CACHE_KEY + drop);
      }
      localStorage.setItem(CACHE_IDX, JSON.stringify(idx));
    } catch (e) {
      try {
        var idx2 = JSON.parse(localStorage.getItem(CACHE_IDX) || '[]');
        while (idx2.length > 24) { localStorage.removeItem(CACHE_KEY + idx2.shift()); }
        localStorage.setItem(CACHE_IDX, JSON.stringify(idx2));
      } catch (e2) { }
    }
  }
  function validate(d) {
    return d && Object.prototype.toString.call(d.strokes) === '[object Array]' &&
      Object.prototype.toString.call(d.medians) === '[object Array]' &&
      d.strokes.length === d.medians.length && d.strokes.length > 0;
  }
  function fetchChar(ch) {
    if (inflight[ch]) return inflight[ch];
    var cached = cacheGet(ch);
    if (cached && validate(cached)) {
      cachePut(ch, cached); // 提升 LRU 位置
      return Promise.resolve(cached);
    }
    inflight[ch] = new Promise(function (resolve) {
      var i = 0;
      function tryNext() {
        if (i >= MIRRORS.length) { inflight[ch] = null; resolve(null); return; }
        var url = MIRRORS[i++] + encodeURIComponent(ch) + '.json';
        fetch(url, { mode: 'cors' }).then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        }).then(function (d) {
          if (!validate(d)) throw new Error('bad data');
          cachePut(ch, d);
          inflight[ch] = null;
          resolve(d);
        }).catch(function () { tryNext(); });
      }
      tryNext();
    });
    return inflight[ch];
  }

  /* ---------------- cnchar 封装 ---------------- */
  function pinyinOf(ch) {
    if (!hasCnchar) return [];
    try {
      var arr = window.cnchar.spell(ch, 'array', 'tone', 'poly', 'low');
      if (arr && arr.length) {
        var first = arr[0];
        if (typeof first === 'string') return arr;          // ['nǐ']
        if (Object.prototype.toString.call(first) === '[object Array]') {
          // poly 模式可能返回嵌套数组
          var out = [];
          first.forEach(function (sub) {
            if (typeof sub === 'string') out.push(sub);
          });
          if (out.length) return out;
        }
      }
      arr = window.cnchar.spell(ch, 'array', 'tone', 'low');
      return (arr && arr.length) ? arr : [];
    } catch (e) { return []; }
  }
  function radicalOf(ch) {
    if (!hasCnchar) return null;
    try {
      var r = window.cnchar.radical(ch, 'array');
      if (r && r[0]) return r[0]; // {radical, radicalCount, struct}
    } catch (e) { }
    return null;
  }
  function cncharStrokeNames(ch) {
    if (!hasCnchar) return null;
    try {
      var r = window.cnchar.stroke(ch, 'order', 'name');
      if (r && r[0] && r[0].length) return r[0];
    } catch (e) { }
    return null;
  }
  function strokeCountOf(ch) {
    if (!hasCnchar) return null;
    try { return window.cnchar.stroke(ch); } catch (e) { return null; }
  }
  function levelOf(ch) {
    if (!window.CHARSET) return '';
    if (window.CHARSET.l1.indexOf(ch) >= 0) return '一级字';
    if (window.CHARSET.l2.indexOf(ch) >= 0) return '二级字';
    return '通用规范汉字';
  }

  /* ---------------- 笔画几何分类（兜底方案，仅 cnchar 无数据时使用） ----------------
     数据坐标系为 y 向上，1024 空间；角度约定：0°=向右，-90°=向下，180°/-180°=向左 */
  function polyLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) {
      L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    return L;
  }
  // 单段方向名（y 向上约定）
  function dirName(ang) {
    if (ang >= -18 && ang <= 18) return 'H';       // 横
    if (ang > 18 && ang <= 70) return 'UR';         // 提
    if (ang >= -70 && ang < -18) return 'DR';       // 捺
    if (ang >= -110 && ang < -70) return 'V';       // 竖
    if (ang >= -180 && ang < -110) return 'DL';     // 撇
    return 'U';                                     // 向上（多为钩，罕见）
  }
  // 折线 -> 平滑段序列 [{ang, len}] + 是否以短钩收尾
  function analyzeMedian(pts) {
    var total = polyLen(pts);
    var segs = [];
    var hook = false;
    if (pts.length >= 2) {
      // 抽稀：合并距离过近的点
      var simp = [pts[0]];
      for (var i = 1; i < pts.length - 1; i++) {
        var last = simp[simp.length - 1];
        if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= 12) simp.push(pts[i]);
      }
      simp.push(pts[pts.length - 1]);
      // 原始分段
      for (var j = 1; j < simp.length; j++) {
        var dx = simp[j][0] - simp[j - 1][0], dy = simp[j][1] - simp[j - 1][1];
        var len = Math.hypot(dx, dy);
        if (len < 6) continue;
        segs.push({ ang: Math.atan2(dy, dx) * 180 / Math.PI, len: len });
      }
      // 平滑合并：相邻方向差 < 50° 合并（长度加权平均方向）
      for (var k = 1; k < segs.length;) {
        var a = segs[k - 1], b = segs[k];
        var d = Math.abs(b.ang - a.ang);
        if (d > 180) d = 360 - d;
        if (d < 50) {
          a.ang = (a.ang * a.len + b.ang * b.len) / (a.len + b.len);
          a.len += b.len;
          segs.splice(k, 1);
        } else k++;
      }
      // 钩识别：末段短、朝上（5°~175°）
      if (segs.length >= 2) {
        var tail = segs[segs.length - 1];
        if (tail.ang > 5 && tail.ang < 175 && tail.len < Math.max(110, total * 0.25)) {
          hook = true;
          segs.pop();
        }
      }
      // 去掉过短的抖动段（并入前段）
      for (var m = segs.length - 1; m > 0; m--) {
        if (segs[m].len < total * 0.1) {
          segs[m - 1].ang = (segs[m - 1].ang * segs[m - 1].len + segs[m].ang * segs[m].len) / (segs[m - 1].len + segs[m].len);
          segs[m - 1].len += segs[m].len;
          segs.splice(m, 1);
        }
      }
      // 头部短段并入后段
      if (segs.length >= 2 && segs[0].len < total * 0.1) {
        segs[1].ang = (segs[1].ang * segs[1].len + segs[0].ang * segs[0].len) / (segs[0].len + segs[1].len);
        segs[1].len += segs[0].len;
        segs.shift();
      }
      // 两段中较短者不足全长 22% 时，视为弯曲笔画的平滑伪折，合并为单段
      if (segs.length === 2) {
        var shorter = Math.min(segs[0].len, segs[1].len);
        if (shorter < total * 0.22) {
          var sumLen = segs[0].len + segs[1].len;
          segs[0].ang = (segs[0].ang * segs[0].len + segs[1].ang * segs[1].len) / sumLen;
          segs[0].len = sumLen;
          segs.pop();
        }
      }
    }
    var chord = (pts.length >= 2)
      ? Math.atan2(pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][0] - pts[0][0]) * 180 / Math.PI
      : 0;
    return { segs: segs, hook: hook, total: total, chord: chord };
  }

  // 段序列匹配用（U 归入 V）
  function seqOf(an) {
    return an.segs.map(function (s) {
      var d = dirName(s.ang);
      return d === 'U' ? 'V' : d;
    });
  }

  /* 标准笔画名 <-> 段方向序列表。'P' 表示任意单段（短点） */
  var NAME_TABLE = [
    ['横', ['H'], false], ['竖', ['V'], false], ['撇', ['DL'], false],
    ['捺', ['DR'], false], ['点', ['P'], false], ['提', ['UR'], false],
    ['横折', ['H', 'V'], false], ['竖折', ['V', 'H'], false], ['竖弯', ['V', 'H'], false],
    ['横撇', ['H', 'DL'], false], ['竖提', ['V', 'UR'], false],
    ['撇折', ['DL', 'H'], false], ['撇点', ['DL', 'DR'], false],
    ['横折弯', ['H', 'DR'], false],
    ['竖钩', ['V'], true], ['横钩', ['H'], true], ['斜钩', ['DR'], true],
    ['横折钩', ['H', 'V'], true], ['竖弯钩', ['V', 'H'], true],
    ['横折提', ['H', 'V', 'UR'], false], ['横折弯钩', ['H', 'DR'], true],
    ['横斜钩', ['H', 'DR'], true],
    ['横折折', ['H', 'V', 'H'], false], ['横折折钩', ['H', 'V', 'H'], true],
    ['横折折撇', ['H', 'V', 'DL'], false],
    ['横折折折', ['H', 'V', 'H', 'V'], false],
    ['横折折折钩', ['H', 'V', 'H', 'V'], true],
    ['竖折折', ['V', 'H', 'V'], false], ['竖折折钩', ['V', 'H', 'V'], true],
    ['竖折撇', ['V', 'DL'], false]
  ];
  var SINGLE_NAME = { H: '横', V: '竖', DL: '撇', DR: '捺', UR: '提' };
  var HOOK_NAME = { H: '横钩', V: '竖钩', DR: '斜钩', DL: '撇', UR: '提' };

  // 几何命名：由段序列推笔画名（简化兜底）
  function geometricName(an) {
    var seq = seqOf(an);
    var n = seq.length;
    if (n === 0) return '点';
    if (an.total < 200) return '点'; // 短笔一律视为点
    if (n === 1) {
      var d = dirName(an.chord);
      if (d === 'U') d = 'V';
      if (an.hook) return HOOK_NAME[d] || '竖钩';
      return SINGLE_NAME[d] || '竖';
    }
    // 多段：查表
    for (var i = 0; i < NAME_TABLE.length; i++) {
      var e = NAME_TABLE[i];
      if (e[2] === an.hook && e[1].length === n) {
        var ok = true;
        for (var t = 0; t < n; t++) if (e[1][t] !== seq[t]) { ok = false; break; }
        if (ok) return e[0];
      }
    }
    if (an.hook) return seq[0] === 'H' ? '横折钩' : '竖弯钩';
    return seq[0] === 'H' ? '横折' : '竖折';
  }

  /* cnchar 无笔顺数据的部首类字符（GB2312 内共 31 个），手工笔画名表（已按几何数据核对） */
  var RADICAL_NAMES = {
    '丨': ['竖'], '丿': ['撇'], '丶': ['点'],
    '匚': ['横', '竖折'], '刂': ['竖', '竖钩'], '亠': ['点', '横'],
    '冫': ['点', '提'], '冖': ['点', '横钩'], '讠': ['点', '横折提'],
    '卩': ['横折钩', '竖'], '阝': ['横撇弯钩', '竖'], '廴': ['横折折撇', '捺'],
    '艹': ['横', '竖', '竖'], '扌': ['横', '竖钩', '提'], '彳': ['撇', '撇', '竖'],
    '彡': ['撇', '撇', '撇'], '犭': ['撇', '弯钩', '撇'], '夂': ['撇', '横撇', '捺'],
    '饣': ['撇', '横钩', '竖提'], '忄': ['点', '点', '竖'], '丬': ['点', '提', '竖'],
    '氵': ['点', '点', '提'], '宀': ['点', '点', '横钩'], '辶': ['点', '横折折撇', '捺'],
    '彐': ['横折', '横', '横'], '屮': ['竖折', '竖', '竖'], '纟': ['撇折', '撇折', '提'],
    '灬': ['点', '点', '点', '点'], '礻': ['点', '横撇', '竖', '点'],
    '疒': ['点', '横', '撇', '点', '提'], '衤': ['点', '横撇', '竖', '撇', '点']
  };

  function splitVariants(n) {
    return (n || '').split(/[|/]/).map(function (x) {
      return (x || '').replace(/\d+$/g, '').trim();
    }).filter(Boolean);
  }

  // 综合：cnchar 名称（取第一变体）> 部首手工表 > 几何兜底
  function strokeNameFor(median, cnName, idx, ch) {
    var rad = RADICAL_NAMES[ch];
    if (rad && idx < rad.length) return rad[idx];
    if (cnName) {
      var v = splitVariants(cnName);
      if (v.length) return v[0];
    }
    return geometricName(analyzeMedian(median));
  }

  function strokeNames(data) {
    var ch = data.char || '';
    var cnList = cncharStrokeNames(ch);
    // cnchar 名称数与笔画数不一致时不逐笔采用（防错位）
    if (cnList && cnList.length !== data.medians.length) cnList = null;
    var names = [];
    for (var i = 0; i < data.medians.length; i++) {
      var cn = (cnList && i < cnList.length) ? cnList[i] : null;
      names.push(strokeNameFor(data.medians[i], cn, i, ch));
    }
    return names;
  }

  /* ---------------- 结构说明 ---------------- */
  var STRUCT_NOTE = {
    '左右结构': '左右两个部件并列，书写时先左后右',
    '左中右结构': '左、中、右三部分并列，依次从左写到右',
    '上下结构': '上下两个部件相叠，书写时从上到下',
    '上中下结构': '上、中、下三部分相叠，依次从上写到下',
    '全包围结构': '外框包围内部，先写外框，最后写封口',
    '半包围结构': '部分部件包围其他部件，一般先外后内',
    '独体结构': '独体字，无法拆分部件，按整体笔顺一气呵成'
  };
  function structNote(s) { return STRUCT_NOTE[s] || ''; }

  /* ---------------- 易错提示 ---------------- */
  var TIPS = {
    '万': '第二笔是横折钩，撇是最后一笔——不要先写撇。',
    '方': '笔顺为点、横、横折钩、撇，撇要最后写。',
    '火': '第一笔是左点，第四笔才是捺——不要先写撇。',
    '出': '共五笔，第三笔是中间的长竖；先完成上半部分，再写下部两笔。',
    '乃': '先写横折折折钩，再写撇。',
    '及': '先撇，再横折折撇，最后写捺。',
    '女': '笔顺为撇点、撇、横——先写两撇，横最后写。',
    '心': '第一笔是左点，第二笔才是卧钩，后两点依次书写。',
    '为': '笔顺为点、撇、横折钩、点，首笔是点。',
    '义': '先写点，再写撇、捺。',
    '车': '笔顺为横、撇折、横、竖，末笔是竖；作左偏旁时末笔变提。',
    '马': '先写横折，再写竖折折钩，最后写横。',
    '鸟': '笔顺为撇、横折钩、点、竖折折钩、横。',
    '与': '第一笔横，第二笔竖折折钩，第三笔横收尾。',
    '门': '先写点，再写竖，最后写横折钩。',
    '九': '先撇后横折弯钩。',
    '刀': '先写横折钩，再写撇。',
    '力': '先写横折钩，再写撇。',
    '七': '先横后竖弯钩。',
    '也': '笔顺为横折钩、竖、竖弯钩。',
    '北': '笔顺为竖、横、提、撇、竖弯钩。',
    '我': '笔顺为撇、横、竖钩、提、斜钩、撇、点，斜钩最长。',
    '水': '先中间竖钩，再左边横撇，后右边撇捺（先中间后两边）。',
    '小': '先中间竖钩，再左右两点（先中间后两边）。',
    '州': '笔顺为点、撇、点、竖、点、竖。',
    '长': '笔顺为撇、横、竖提、捺。',
    '凶': '先写里面的撇、点，再写竖折、竖（先里头后封口）。'
  };
  var RULES = [
    '先横后竖（如「十」）', '先撇后捺（如「人」）', '从上到下（如「三」）',
    '从左到右（如「川」）', '先外后内（如「月」）', '先中间后两边（如「小」）',
    '先里头后封口（如「国」）'
  ];

  function tipsFor(ch, struct) {
    var out = [];
    if (TIPS[ch]) out.push({ type: 'warn', title: '「' + ch + '」笔顺要点', text: TIPS[ch] });
    if (struct === '全包围结构') out.push({ type: 'warn', title: '包围结构', text: '先写外框，再写里面，最后一笔写封口的横。' });
    if (out.length < 3) out.push({ type: 'rule', title: '书写规则', text: RULES.join(' · ') });
    return out;
  }

  /* ---------------- 对外接口 ---------------- */
  window.DS = {
    sanitize: sanitize,
    fetchChar: fetchChar,
    cached: function (ch) { return !!cacheGet(ch); },
    pinyin: pinyinOf,
    radical: radicalOf,
    strokeCount: strokeCountOf,
    level: levelOf,
    strokeNames: strokeNames,
    analyze: analyzeMedian,
    structNote: structNote,
    tips: tipsFor,
    hasCnchar: function () { return hasCnchar; },
    pinyinPlain: function (ch) {
      var arr = pinyinOf(ch);
      return arr.length ? arr[0].toLowerCase().replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e')
        .replace(/[īíǐì]/g, 'i').replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'v') : '';
    }
  };
})();
