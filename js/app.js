/* 应用装配：界面状态、输入队列、舞台控制、练习、汉字库、收藏/历史、导出 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ---------------- 设置 ---------------- */
  var settings = {
    speed: 1, grid: true, outline: true, numbers: true, autonext: false,
    strict: 1, pOutline: 1
  };
  try {
    var saved = JSON.parse(localStorage.getItem('hbh.settings') || '{}');
    for (var k in saved) settings[k] = saved[k];
  } catch (e) { }
  function saveSettings() { try { localStorage.setItem('hbh.settings', JSON.stringify(settings)); } catch (e) { } }

  /* ---------------- 状态 ---------------- */
  var queue = [];
  var failedSet = {};
  var currentChar = '', currentData = null, currentNames = [], currentPinyin = '';
  var player = null;
  var favs = [], hist = [];
  try { favs = JSON.parse(localStorage.getItem('hbh.favs') || '[]'); } catch (e) { }
  try { hist = JSON.parse(localStorage.getItem('hbh.hist') || '[]'); } catch (e) { }

  function saveFavs() { try { localStorage.setItem('hbh.favs', JSON.stringify(favs)); } catch (e) { } }
  function saveHist() { try { localStorage.setItem('hbh.hist', JSON.stringify(hist)); } catch (e) { } }

  /* ---------------- 工具 ---------------- */
  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2400);
    setTimeout(function () { t.remove(); }, 2800);
  }

  /* ---------------- 标签页 ---------------- */
  function switchTab(name) {
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    $$('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
    if (name === 'practice' && !currentData) { $('#quiz-mask').classList.remove('hidden'); }
    if (name === 'library') initLibrary();
    if (name === 'favs') renderFavs();
    if (name === 'history') renderHist();
    if (name === 'learn' && player) { /* 保持 */ }
  }
  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) switchTab(b.dataset.tab);
  });

  /* ---------------- 输入队列 ---------------- */
  function renderQueue() {
    var box = $('#queue');
    $('#queue-count').textContent = queue.length ? ('共 ' + queue.length + ' 字') : '';
    if (!queue.length) {
      box.innerHTML = '<div class="queue-empty">队列为空，在上方输入汉字开始学习</div>';
      return;
    }
    box.innerHTML = '';
    queue.forEach(function (ch) {
      var c = document.createElement('button');
      c.className = 'queue-chip' + (ch === currentChar ? ' active' : '') + (failedSet[ch] ? ' nodata' : '');
      var sc = DS.strokeCount(ch);
      c.innerHTML = ch + '<small>' + (failedSet[ch] ? '无数据' : (sc ? sc + '画' : '·')) + '</small>';
      c.title = ch;
      c.onclick = function () { selectChar(ch); };
      box.appendChild(c);
    });
  }

  function addToQueue(raw, silent) {
    var before = (raw || '').length;
    var clean = DS.sanitize(raw);
    var filtered = before - clean.length;
    if (filtered > 0 && !silent) toast('已自动过滤 ' + filtered + ' 个非汉字字符', 'warn');
    if (!clean) { if (!silent) toast('请输入有效中文汉字'); return; }
    var added = 0, dup = 0;
    for (var i = 0; i < clean.length && queue.length < 100; i++) {
      var ch = clean[i];
      if (queue.indexOf(ch) >= 0) { dup++; continue; } // 队列内去重
      queue.push(ch); added++;
    }
    if (queue.length >= 100 && clean.length > added + dup) toast('队列已达上限 100 字', 'warn');
    renderQueue();
    if (silent) return;
    if (added === 1) selectChar(clean[0]);
    else if (added === 0) toast('这些汉字已在学习队列中');
    else toast('已添加 ' + added + ' 个汉字，点击队列中的字开始学习');
  }

  $('#btn-add').onclick = function () { addToQueue($('#char-input').value); $('#char-input').value = ''; };
  $('#char-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { addToQueue(this.value); this.value = ''; }
  });
  $('#char-input').addEventListener('input', function () {
    var v = this.value, c = DS.sanitize(v);
    if (c !== v) { this.value = c; toast('仅支持中文汉字，已自动过滤', 'warn'); }
  });
  $('#btn-sample').onclick = function () { addToQueue('永火出万方国好学汉字笔顺', true); toast('已添加示例汉字'); };
  $('#btn-clear-queue').onclick = function () {
    if (!queue.length) return;
    if (confirm('确定清空学习队列？')) { queue = []; renderQueue(); }
  };

  /* ---------------- 舞台 ---------------- */
  var lastUpdateKey = '';
  function statusText(st) {
    var key = st.cursor + '|' + (st.playing ? 1 : 0) + '|' + (st.done ? 1 : 0);
    if (key === lastUpdateKey) return;
    lastUpdateKey = key;
    var n = currentData ? currentData.strokes.length : 0;
    if (st.done) {
      $('#stroke-status').innerHTML = '书写完成';
    } else if (st.playing && st.cursor < n) {
      var nm = currentNames[st.cursor] || '';
      $('#stroke-status').innerHTML = '第 <b>' + (st.cursor + 1) + '</b> 笔 · <span class="stroke-name">' + nm + '</span>';
    } else {
      $('#stroke-status').innerHTML = '已写 ' + st.cursor + '/' + n + ' 笔，点击播放继续';
    }
    $('#stroke-progress').textContent = st.cursor + ' / ' + n;
    $('#btn-play').innerHTML = st.playing ? '⏸ 暂停' : (st.cursor >= n && n ? '▶ 重新播放' : '▶ 播放');
    $$('#stroke-list .stroke-item').forEach(function (r, i) {
      r.classList.toggle('current', i === st.cursor && !st.done);
    });
    var listEl = $('#stroke-list');
    var cur = listEl.querySelector('.stroke-item.current');
    if (cur) {
      var rtop = cur.offsetTop - listEl.clientHeight / 2 + cur.clientHeight / 2;
      if (rtop >= 0 && Math.abs(listEl.scrollTop - rtop) > 60) listEl.scrollTop = rtop;
    }
  }

  function updatePlayBtn() { $('#btn-play').innerHTML = player && player.playing ? '⏸ 暂停' : '▶ 播放'; }

  function destroyPlayer() { if (player) { player.destroy(); player = null; } }

  function buildPlayer(data) {
    destroyPlayer();
    player = new StrokePlayer($('#stage'), data, {
      speed: settings.speed,
      grid: settings.grid,
      outline: settings.outline,
      numbers: settings.numbers,
      onUpdate: statusText,
      onComplete: function () {
        statusText({ cursor: data.strokes.length, total: data.strokes.length, playing: false, done: true, progress: 1 });
        if (settings.autonext) {
          setTimeout(function () {
            var i = queue.indexOf(currentChar);
            if (i >= 0 && i + 1 < queue.length) selectChar(queue[i + 1]);
          }, 1200);
        }
      }
    });
    setTimeout(function () { if (player) player.play(); }, 120);
  }

  function miniStrokeSVG(median, d) {
    var xs = median.map(function (p) { return p[0]; }), ys = median.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs) - 70, x1 = Math.max.apply(null, xs) + 70;
    var y0 = Math.min.apply(null, ys) - 70, y1 = Math.max.apply(null, ys) + 70;
    var vb = x0 + ' ' + y0 + ' ' + (x1 - x0) + ' ' + (y1 - y0);
    return '<svg viewBox="' + vb + '"><g transform="translate(0,' + (y0 + y1) + ') scale(1,-1)">' +
      '<path d="' + d + '"/></g></svg>';
  }

  function renderStrokeList(data, names) {
    var box = $('#stroke-list');
    box.innerHTML = '';
    data.strokes.forEach(function (d, i) {
      var row = document.createElement('div');
      row.className = 'stroke-item';
      row.innerHTML = '<span class="no">' + (i + 1) + '</span>' + miniStrokeSVG(data.medians[i], d) +
        '<span class="nm">' + (names[i] || '?') + '<small>第' + (i + 1) + '笔</small></span>';
      row.onclick = function () {
        if (!player) return;
        player.pause();
        if (player.cursor - 1 === i || player.cursor === i) {
          player.cursor = i; player.progress = 0; player.stepNext();
        } else {
          player.cursor = i; player.progress = 0; player.stepNext();
        }
      };
      box.appendChild(row);
    });
  }

  function renderInfo(ch, data, names) {
    var pys = DS.pinyin(ch);
    currentPinyin = pys.length ? pys[0] : '';
    $('#stage-pinyin').textContent = pys.length ? pys.join(' / ') : '—';
    $('#stage-char').textContent = ch;
    $('#stroke-count').textContent = data.strokes.length;
    $('#char-level').textContent = DS.level(ch);
    $('#info-pinyin').textContent = pys.length ? pys.join(' / ') : '—';
    var r = DS.radical(ch);
    $('#info-radical').textContent = r ? (r.radical + '（' + r.radicalCount + '画）') : '—';
    var st = r ? r.struct : '';
    $('#info-struct').textContent = st || '—';
    $('#info-struct-note').textContent = st ? DS.structNote(st) : '暂无结构说明';
    var tips = DS.tips(ch, st);
    var tipsBox = $('#tips');
    tipsBox.innerHTML = '';
    tips.forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'tip-item' + (t.type === 'rule' ? ' rule' : '');
      d.innerHTML = '<b>' + t.title + '</b>' + t.text;
      tipsBox.appendChild(d);
    });
    $('#btn-fav').innerHTML = favs.indexOf(ch) >= 0 ? '★ 已收藏' : '☆ 收藏';
  }

  function selectChar(ch) {
    if (ch === currentChar && currentData) { renderQueue(); return; }
    currentChar = ch;
    currentData = null;
    renderQueue();
    $('#stage-error').classList.add('hidden');
    $('#stage-loading').classList.remove('hidden');
    $('#stroke-status').textContent = '加载中…';
    $('#stroke-list').innerHTML = '';
    $('#tips').innerHTML = '';
    DS.fetchChar(ch).then(function (data) {
      if (currentChar !== ch) return;
      $('#stage-loading').classList.add('hidden');
      if (!data) {
        failedSet[ch] = 1;
        destroyPlayer();
        $('#stage').innerHTML = '';
        $('#stage-error').classList.remove('hidden');
        toast('「' + ch + '」暂无笔画数据', 'warn');
        renderQueue();
        return;
      }
      delete failedSet[ch];
      currentData = data;
      currentNames = DS.strokeNames({ char: ch, strokes: data.strokes, medians: data.medians });
      renderInfo(ch, data, currentNames);
      renderStrokeList(data, currentNames);
      lastUpdateKey = '';
      buildPlayer(data);
      recordHistory(ch);
    });
  }

  /* ---------------- 舞台控制 ---------------- */
  $('#btn-play').onclick = function () {
    if (!player) return;
    if (player.playing) player.pause();
    else if (player.isDone()) player.replay();
    else player.play();
    updatePlayBtn();
  };
  $('#btn-replay').onclick = function () { if (player) { player.replay(); updatePlayBtn(); } };
  $('#btn-next').onclick = function () { if (player) { player.stepNext(); updatePlayBtn(); } };
  $('#btn-prev').onclick = function () { if (player) { player.stepPrev(); updatePlayBtn(); } };

  $$('#speed-group button').forEach(function (b) {
    b.classList.toggle('active', parseFloat(b.dataset.speed) === settings.speed);
    b.onclick = function () {
      settings.speed = parseFloat(b.dataset.speed);
      $$('#speed-group button').forEach(function (x) { x.classList.toggle('active', x === b); });
      if (player) player.setSpeed(settings.speed);
      saveSettings();
    };
  });

  function bindToggle(id, key, apply) {
    var elT = $(id);
    elT.checked = !!settings[key];
    elT.addEventListener('change', function () {
      settings[key] = elT.checked;
      if (apply) apply(elT.checked);
      saveSettings();
    });
  }
  bindToggle('#tg-grid', 'grid', function (v) { if (player) player.setGrid(v); });
  bindToggle('#tg-outline', 'outline', function (v) { if (player) player.setOutline(v); });
  bindToggle('#tg-nums', 'numbers', function (v) { if (player) { player.opts.numbers = v; player._render(); } });
  bindToggle('#tg-autonext', 'autonext');

  document.addEventListener('keydown', function (e) {
    if (!$('#tab-learn').classList.contains('active')) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (!player) return;
    if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); $('#btn-next').click(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); $('#btn-prev').click(); }
    else if (e.code === 'KeyR') { $('#btn-replay').click(); }
  });

  /* ---------------- 收藏 ---------------- */
  $('#btn-fav').onclick = function () {
    if (!currentChar) return;
    var i = favs.indexOf(currentChar);
    if (i >= 0) { favs.splice(i, 1); toast('已取消收藏'); }
    else { favs.unshift(currentChar); toast('已收藏「' + currentChar + '」', 'ok'); }
    saveFavs();
    $('#btn-fav').innerHTML = favs.indexOf(currentChar) >= 0 ? '★ 已收藏' : '☆ 收藏';
  };

  function renderCharCells(boxId, list) {
    var box = $(boxId);
    box.innerHTML = '';
    list.forEach(function (ch) {
      var cell = document.createElement('div');
      cell.className = 'char-cell' + (favs.indexOf(ch) >= 0 ? ' faved' : '');
      var py = DS.pinyin(ch);
      cell.innerHTML = '<span class="c">' + ch + '</span><span class="p">' + (py[0] || '') + '</span><span class="lv">' + DS.level(ch) + '</span>';
      cell.onclick = function () { switchTab('learn'); selectChar(ch); };
      box.appendChild(cell);
    });
  }
  function renderFavs() {
    $('#favs-count').textContent = '共 ' + favs.length + ' 个收藏';
    renderCharCells('#favs-grid', favs);
    $('#favs-empty').style.display = favs.length ? 'none' : '';
  }
  $('#btn-clear-favs').onclick = function () {
    if (!favs.length) return;
    if (confirm('确定清空全部收藏？')) { favs = []; saveFavs(); renderFavs(); }
  };

  function recordHistory(ch) {
    if (hist[0] === ch) return;
    hist.unshift(ch);
    if (hist.length > 200) hist.length = 200;
    saveHist();
  }
  function renderHist() {
    $('#hist-count').textContent = '共 ' + hist.length + ' 条记录';
    renderCharCells('#hist-grid', hist);
    $('#hist-empty').style.display = hist.length ? 'none' : '';
  }
  $('#btn-clear-hist').onclick = function () {
    if (!hist.length) return;
    if (confirm('确定清空全部历史记录？')) { hist = []; saveHist(); renderHist(); }
  };

  /* ---------------- 临摹练习 ---------------- */
  var practiceChar = '';
  function startPractice() {
    if (!currentData) { toast('请先在学习页加载一个汉字', 'warn'); return; }
    practiceChar = currentChar;
    $('#quiz-mask').classList.add('hidden');
    $('#p-char-info').textContent = '「' + currentChar + '」 ' + DS.pinyin(currentChar).join(' / ') + ' · ' + currentData.strokes.length + '画';
    $('#p-mistakes').textContent = '0';
    $('#p-score').textContent = '—';
    $('#p-progress').textContent = '0 / ' + currentData.strokes.length;
    $('#p-status').textContent = '在米字格内按笔顺描写每一笔';
    $('#p-status').className = 'practice-status';
    var box = $('#quiz-area');
    box.innerHTML = '';
    Practice.start(currentChar, box, {
      leniency: settings.strict,
      outline: settings.pOutline === 1,
      total: currentData.strokes.length,
      strokeNames: currentNames
    });
  }
  Practice.setHandlers({
    onStatus: function (msg, type) {
      $('#p-status').textContent = msg;
      $('#p-status').className = 'practice-status ' + type;
    },
    onProgress: function (done, total, mis, totalMis) {
      $('#p-progress').textContent = done + ' / ' + total;
      $('#p-mistakes').textContent = totalMis;
    },
    onComplete: function (res) {
      var total = res.total, mis = res.totalMistakes;
      var score = Math.max(0, 100 - mis * 8);
      $('#p-score').textContent = score;
      var stars = score >= 90 ? '★★★' : score >= 75 ? '★★☆' : score >= 60 ? '★☆☆' : '☆☆☆';
      var grade = score >= 90 ? '笔顺掌握得非常好！' : score >= 75 ? '很棒，再细心一点就完美了' : score >= 60 ? '还不错，多练几遍会更熟练' : '继续加油，跟着演示再写一遍';
      $('#modal-score').textContent = score + ' 分';
      $('#modal-stars').textContent = stars;
      $('#modal-detail').innerHTML = '「' + practiceChar + '」共 ' + total + ' 画 · 失误 ' + mis + ' 次<br>' + grade;
      $('#modal-mask').classList.remove('hidden');
      recordHistory(practiceChar);
    }
  });
  $('#btn-practice').onclick = function () { switchTab('practice'); startPractice(); };
  $('#btn-goto-learn').onclick = function () { switchTab('learn'); };
  $('#btn-p-back').onclick = function () { Practice.destroy(); switchTab('learn'); };
  $('#btn-p-restart').onclick = function () { if (practiceChar) startPractice(); };
  $('#p-strict').value = String(settings.strict);
  $('#p-strict').onchange = function () { settings.strict = parseFloat(this.value); saveSettings(); if (practiceChar) startPractice(); };
  $('#p-outline').value = String(settings.pOutline);
  $('#p-outline').onchange = function () { settings.pOutline = parseInt(this.value, 10); saveSettings(); if (practiceChar) startPractice(); };

  $('#btn-modal-close').onclick = function () { $('#modal-mask').classList.add('hidden'); };
  $('#btn-modal-again').onclick = function () { $('#modal-mask').classList.add('hidden'); startPractice(); };
  $('#btn-modal-next').onclick = function () {
    $('#modal-mask').classList.add('hidden');
    var i = queue.indexOf(practiceChar);
    if (i >= 0 && i + 1 < queue.length) { selectChar(queue[i + 1]); setTimeout(startPractice, 900); }
    else { switchTab('learn'); }
  };

  /* ---------------- 导出 ---------------- */
  $('#btn-export-svg').onclick = function () {
    if (!currentData) { toast('请先加载汉字', 'warn'); return; }
    Exporter.exportSVG(currentChar, currentData, currentNames, currentPinyin);
    toast('已导出「笔顺-' + currentChar + '.svg」，浏览器打开即可播放', 'ok');
  };
  $('#btn-export-webm').onclick = function () {
    if (!currentData) { toast('请先加载汉字', 'warn'); return; }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      toast('当前浏览器不支持视频录制，请使用 SVG 导出', 'warn');
      return;
    }
    $('#export-mask').classList.remove('hidden');
    $('#export-status').textContent = '渲染中 0%';
    var finished = false;
    var fallback = setTimeout(function () {
      if (finished) return;
      $('#export-mask').classList.add('hidden');
      toast('视频导出超时，请重试或改用 SVG 导出', 'warn');
    }, 45000);
    Exporter.exportWebM(currentChar, currentData, currentNames, currentPinyin, function (pct) {
      $('#export-status').textContent = pct >= 100 ? '正在保存视频…' : ('渲染中 ' + pct + '%');
    }).then(function () {
      finished = true; clearTimeout(fallback);
      $('#export-mask').classList.add('hidden');
      toast('已导出「笔顺-' + currentChar + '.webm」', 'ok');
    }).catch(function (e) {
      finished = true; clearTimeout(fallback);
      $('#export-mask').classList.add('hidden');
      toast(e.message || '导出失败', 'warn');
    });
  };

  /* ---------------- 汉字库 ---------------- */
  var libState = { mode: 'pinyin', level: 'all', key: null, page: 1, search: '' };
  var PAGE = 240;
  var libBuilt = false;

  function initLibrary() {
    if (libBuilt) { renderLib(); return; }
    $('#lib-building').classList.remove('hidden');
    Library.ensureIndex(function (pct) {
      $('#lib-building').textContent = '正在建立索引… ' + pct + '%';
    }).then(function () {
      libBuilt = true;
      $('#lib-building').classList.add('hidden');
      libState.key = libState.key || (Library.listKeys('pinyin', 'all')[0] || 'A');
      renderLib();
    });
  }

  function renderLibIndex() {
    var box = $('#lib-index');
    box.innerHTML = '';
    var keys = Library.listKeys(libState.mode, libState.level);
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = k;
      if (k === libState.key) b.classList.add('active');
      b.onclick = function () {
        libState.key = k; libState.page = 1; libState.search = '';
        $('#lib-search').value = '';
        renderLib();
      };
      box.appendChild(b);
    });
  }

  function renderLib() {
    renderLibIndex();
    var list;
    if (libState.search) list = Library.search(libState.search, libState.level);
    else list = libState.key ? Library.getByKey(libState.mode, libState.key, libState.level) : [];
    var shown = list.slice(0, PAGE * libState.page);
    renderCharCells('#lib-grid', shown);
    $('#btn-lib-more').classList.toggle('hidden', shown.length >= list.length);
    $('#lib-count').textContent = '当前 ' + shown.length + ' / ' + list.length + ' 字' +
      (libState.search ? '（检索：' + libState.search + '）' : '');
  }

  var searchTimer = null;
  $('#lib-search').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var v = this.value.trim();
    searchTimer = setTimeout(function () {
      libState.search = v; libState.page = 1;
      if (libBuilt) renderLib();
    }, 250);
  });
  $('#lib-level').onchange = function () { libState.level = this.value; libState.page = 1; renderLib(); };
  $('#lib-mode').onchange = function () {
    libState.mode = this.value; libState.page = 1;
    libState.key = Library.listKeys(this.value, libState.level)[0] || null;
    renderLib();
  };
  $('#btn-lib-more').onclick = function () { libState.page++; renderLib(); };

  /* ---------------- 启动 ---------------- */
  addToQueue('永火出万方国好学', true);
  renderQueue();
  selectChar('永');
  if (!DS.hasCnchar()) {
    toast('拼音/部首数据加载失败，部分辅助信息不可用', 'warn');
  }
})();
