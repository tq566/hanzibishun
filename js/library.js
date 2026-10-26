/* 汉字库：拼音/部首索引（懒构建）与检索 */
(function () {
  'use strict';

  var idx = null; // { letters:{}, radicals:{}, radicalOrder:[], plains:{} }
  var l1Set = null, l2Set = null;

  function initSets() {
    if (!l1Set) l1Set = new Set(window.CHARSET.l1.split(''));
    if (!l2Set) l2Set = new Set(window.CHARSET.l2.split(''));
  }
  function inLevel(ch, level) {
    initSets();
    if (level === 'l1') return l1Set.has(ch);
    if (level === 'l2') return l2Set.has(ch);
    return l1Set.has(ch) || l2Set.has(ch);
  }

  // 分块构建索引，避免长时间阻塞 UI
  function ensureIndex(onProgress) {
    if (idx) return Promise.resolve(idx);
    initSets();
    var all = window.CHARSET.all.split('');
    var letters = {}, radicals = {}, plains = {};
    var i = 0, CHUNK = 400;
    idx = {}; // 占位，防重入

    function step() {
      var end = Math.min(i + CHUNK, all.length);
      for (; i < end; i++) {
        var ch = all[i];
        var py = DS.pinyinPlain(ch);
        if (py) {
          var L = py.charAt(0).toUpperCase();
          if (!letters[L]) letters[L] = [];
          letters[L].push(ch);
          plains[ch] = [py];
          // 多音字：补充其他读音
          if (DS.hasCnchar()) {
            try {
              var multi = window.cnchar.spell(ch, 'low', 'array', 'poly');
              if (multi && multi[0] && typeof multi[0] !== 'string') {
                multi[0].forEach(function (p) {
                  if (typeof p === 'string' && p.indexOf(',') < 0) {
                    var plain = p.toLowerCase().replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e')
                      .replace(/[īíǐì]/g, 'i').replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u')
                      .replace(/[ǖǘǚǜ]/g, 'v');
                    if (plains[ch].indexOf(plain) < 0) plains[ch].push(plain);
                  }
                });
              }
            } catch (e) { }
          }
        } else {
          if (!letters['#']) letters['#'] = [];
          letters['#'].push(ch);
        }
        var r = DS.radical(ch);
        var rc = (r && r.radical) ? r.radical : '其他';
        if (!radicals[rc]) radicals[rc] = [];
        radicals[rc].push(ch);
      }
      if (onProgress) onProgress(Math.round(i / all.length * 100));
      if (i < all.length) {
        return new Promise(function (res) { setTimeout(res, 0); }).then(step);
      }
      // 部首按自身笔画排序
      var radicalOrder = Object.keys(radicals);
      radicalOrder.sort(function (a, b) {
        var ca = a === '其他' ? 99 : (DS.strokeCount(a) || 1);
        var cb = b === '其他' ? 99 : (DS.strokeCount(b) || 1);
        if (ca !== cb) return ca - cb;
        return a.localeCompare(b, 'zh');
      });
      idx = { letters: letters, radicals: radicals, radicalOrder: radicalOrder, plains: plains };
      return Promise.resolve(idx);
    }
    return step();
  }

  function listKeys(mode, level) {
    if (mode === 'radical') return idx ? idx.radicalOrder : [];
    var ks = idx ? Object.keys(idx.letters).sort() : [];
    return ks;
  }
  function getByKey(mode, key, level) {
    if (!idx) return [];
    var arr = (mode === 'radical' ? idx.radicals[key] : idx.letters[key]) || [];
    return arr.filter(function (ch) { return inLevel(ch, level); });
  }
  function search(q, level) {
    if (!idx) return [];
    var out = [];
    var seen = {};
    // 直接输入汉字：逐一返回
    var hz = (q || '').replace(/[^\u4e00-\u9fff]/g, '');
    if (hz) {
      for (var i = 0; i < hz.length && out.length < 300; i++) {
        var c = hz.charAt(i);
        if (inLevel(c, level) && !seen[c]) { seen[c] = 1; out.push(c); }
      }
      return out;
    }
    var key = q.toLowerCase().trim().replace(/\s/g, '');
    if (!key) return [];
    var all = window.CHARSET.all.split('');
    for (var j = 0; j < all.length && out.length < 300; j++) {
      var ch = all[j];
      if (!inLevel(ch, level) || seen[ch]) continue;
      var pys = idx.plains[ch] || [];
      for (var k = 0; k < pys.length; k++) {
        if (pys[k] === key || pys[k].indexOf(key) === 0) { seen[ch] = 1; out.push(ch); break; }
      }
    }
    return out;
  }

  window.Library = {
    ensureIndex: ensureIndex,
    inLevel: inLevel,
    listKeys: listKeys,
    getByKey: getByKey,
    search: search,
    ready: function () { return !!idx; }
  };
})();
