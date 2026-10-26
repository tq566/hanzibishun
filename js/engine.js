/* 笔画动画引擎：SVG 渲染 + 逐笔书写动画（笔尖/起收笔轨迹提示/高亮/半透明完成/多档速度/步进） */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var uidSeed = 0;

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) { if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(node);
    return node;
  }
  function pt(p) { return p[0] + ',' + p[1]; }
  function ptsStr(m) {
    var s = [];
    for (var i = 0; i < m.length; i++) s.push(pt(m[i]));
    return s.join(' ');
  }
  function polyLen(m) {
    var L = 0;
    for (var i = 1; i < m.length; i++) L += Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
    return L;
  }
  function pointAt(m, dist) {
    if (dist <= 0) return m[0];
    for (var i = 1; i < m.length; i++) {
      var dx = m[i][0] - m[i - 1][0], dy = m[i][1] - m[i - 1][1];
      var seg = Math.hypot(dx, dy);
      if (dist <= seg) {
        var t = seg ? dist / seg : 0;
        return [m[i - 1][0] + dx * t, m[i - 1][1] + dy * t];
      }
      dist -= seg;
    }
    return m[m.length - 1];
  }
  function endAngle(m) {
    var n = m.length;
    for (var i = n - 1; i > 0; i--) {
      var dx = m[i][0] - m[i - 1][0], dy = m[i][1] - m[i - 1][1];
      if (Math.hypot(dx, dy) > 20) return Math.atan2(dy, dx) * 180 / Math.PI;
    }
    return 0;
  }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /**
   * StrokePlayer(container, data, opts)
   * opts: { speed, onComplete, onUpdate, grid, outline, numbers }
   */
  function StrokePlayer(container, data, opts) {
    this.container = container;
    this.data = data;
    this.opts = opts || {};
    this.speed = opts.speed || 1;
    this.cursor = 0;          // 下一笔索引
    this.progress = 0;       // 当前笔动画进度 0..1
    this.playing = false;
    this.stopAfter = -1;      // 步进：写完第 stopAfter 笔后暂停
    this.gapLeft = 0;
    this.destroyed = false;
    this._build();
    this._render();
  }

  StrokePlayer.prototype._build = function () {
    var d = this.data;
    var uid = 'sp' + (++uidSeed);
    this.uid = uid;
    this.maskIds = [];
    this.lengths = [];
    this.durations = [];
    for (var i = 0; i < d.strokes.length; i++) {
      this.lengths.push(polyLen(d.medians[i]));
      this.durations.push(Math.max(300, Math.min(1500, 260 + this.lengths[i] * 1.05)));
    }

    var svg = el('svg', { viewBox: '0 0 1024 1024', 'class': 'stroke-svg' });
    this.svg = svg;

    var defs = el('defs', null, svg);
    for (var j = 0; j < d.strokes.length; j++) {
      var mask = el('mask', { id: uid + 'm' + j, x: 0, y: 0, width: 1024, height: 1024, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse' }, defs);
      var line = el('polyline', {
        points: ptsStr(d.medians[j]), fill: 'none', stroke: '#fff',
        'stroke-width': 210, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': this.lengths[j], 'stroke-dashoffset': this.lengths[j]
      }, mask);
      this.maskIds.push(line);
    }

    // 米字格（不翻转）
    var grid = el('g', { 'class': 'hz-grid' }, svg);
    el('rect', { x: 8, y: 8, width: 1008, height: 1008, rx: 4, fill: 'none', stroke: '#d9cdb4', 'stroke-width': 3 }, grid);
    el('line', { x1: 512, y1: 8, x2: 512, y2: 1016, stroke: '#e2d7bd', 'stroke-width': 2, 'stroke-dasharray': '14 12' }, grid);
    el('line', { x1: 8, y1: 512, x2: 1016, y2: 512, stroke: '#e2d7bd', 'stroke-width': 2, 'stroke-dasharray': '14 12' }, grid);
    el('line', { x1: 8, y1: 8, x2: 1016, y2: 1016, stroke: '#eee6d2', 'stroke-width': 2, 'stroke-dasharray': '10 16' }, grid);
    el('line', { x1: 1016, y1: 8, x2: 8, y2: 1016, stroke: '#eee6d2', 'stroke-width': 2, 'stroke-dasharray': '10 16' }, grid);
    this.gridEl = grid;

    // 翻转组：数据坐标系为 y 向上
    var flip = el('g', { transform: 'translate(0,1024) scale(1,-1)' }, svg);
    this.flip = flip;

    // 幽灵轮廓
    var ghost = el('g', { 'class': 'hz-ghost' }, flip);
    this.ghostPaths = [];
    for (var k = 0; k < d.strokes.length; k++) {
      this.ghostPaths.push(el('path', { d: d.strokes[k], fill: '#e6dec9' }, ghost));
    }
    this.ghostEl = ghost;

    // 笔画层
    this.strokeEls = [];
    for (var m = 0; m < d.strokes.length; m++) {
      var g = el('g', { mask: 'url(#' + uid + 'm' + m + ')' }, flip);
      this.strokeEls.push(el('path', { d: d.strokes[m], fill: '#d84343', opacity: 0 }, g));
    }

    // 引导层（屏幕坐标，不翻转）
    var guide = el('g', { 'class': 'hz-guide' }, svg);
    this.guideStart = el('circle', { r: 26, fill: 'none', stroke: '#d84343', 'stroke-width': 7, opacity: 0 }, guide);
    this.guideDash = el('path', { fill: 'none', stroke: '#e5938b', 'stroke-width': 9, 'stroke-dasharray': '3 15', 'stroke-linecap': 'round', opacity: 0 }, guide);
    this.guideTip = el('circle', { r: 19, fill: '#2f3542', stroke: '#fff', 'stroke-width': 5, opacity: 0 }, guide);
    this.guideArrow = el('path', { fill: '#d84343', opacity: 0 }, guide);

    // 笔画编号（屏幕坐标）
    this.badges = [];
    var nums = el('g', { 'class': 'hz-nums' }, svg);
    for (var n = 0; n < d.strokes.length; n++) {
      var b = el('text', {
        'font-size': 56, 'font-weight': 700, fill: '#b98a2f',
        'text-anchor': 'middle', 'dominant-baseline': 'central', opacity: 0
      }, nums);
      b.textContent = (n + 1);
      this.badges.push(b);
    }

    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this._applyToggles();
  };

  StrokePlayer.prototype._applyToggles = function () {
    var o = this.opts;
    this.gridEl.style.display = o.grid === false ? 'none' : '';
    this.ghostEl.style.display = o.outline === false ? 'none' : '';
  };

  StrokePlayer.prototype.setGrid = function (v) { this.opts.grid = v; this._applyToggles(); };
  StrokePlayer.prototype.setOutline = function (v) { this.opts.outline = v; this._applyToggles(); };
  StrokePlayer.prototype.setNumbers = function (v) { this.opts.numbers = v; this._render(); };

  StrokePlayer.prototype._render = function () {
    var n = this.data.strokes.length;
    for (var i = 0; i < n; i++) {
      var elS = this.strokeEls[i];
      var line = this.maskIds[i];
      if (i < this.cursor) {
        elS.setAttribute('opacity', 0.38);
        elS.setAttribute('fill', '#5d6b84');
        line.setAttribute('stroke-dashoffset', 0);
        if (!this._badgeSet) this._badgeSet = {};
        if (!this._badgeSet[i]) { this._setBadgePos(i); this._badgeSet[i] = 1; }
        this.badges[i].setAttribute('opacity', this.opts.numbers ? 0.85 : 0);
      } else if (i === this.cursor && (this.playing || this.progress > 0)) {
        elS.setAttribute('opacity', 1);
        elS.setAttribute('fill', '#d84343');
        line.setAttribute('stroke-dashoffset', this.lengths[i] * (1 - this.progress));
        this.badges[i].setAttribute('opacity', 0);
      } else {
        elS.setAttribute('opacity', 0);
        line.setAttribute('stroke-dashoffset', this.lengths[i]);
        this.badges[i].setAttribute('opacity', 0);
      }
    }
    this._updateGuide();
    if (this.opts.onUpdate) {
      this.opts.onUpdate({
        cursor: this.cursor,
        total: n,
        progress: this.progress,
        playing: this.playing,
        done: this.cursor >= n
      });
    }
  };

  // 引导元素使用屏幕坐标：y' = 1024 - y
  StrokePlayer.prototype._updateGuide = function () {
    var n = this.data.strokes.length;
    var show = this.cursor < n && (this.playing || this.progress > 0);
    if (!show) {
      this.guideStart.setAttribute('opacity', 0);
      this.guideDash.setAttribute('opacity', 0);
      this.guideTip.setAttribute('opacity', 0);
      this.guideArrow.setAttribute('opacity', 0);
      return;
    }
    var m = this.data.medians[this.cursor];
    var p = this.progress;
    var s = [m[0][0], 1024 - m[0][1]];
    var tip = pointAt(m, this.lengths[this.cursor] * easeInOut(p));
    var tipY = [tip[0], 1024 - tip[1]];
    // 起笔标记
    this.guideStart.setAttribute('cx', s[0]);
    this.guideStart.setAttribute('cy', s[1]);
    this.guideStart.setAttribute('opacity', p < 0.25 ? 0.9 : 0);
    // 行笔虚线（完整轨迹提示）
    this.guideDash.setAttribute('d', 'M ' + m.map(function (q) { return q[0] + ' ' + (1024 - q[1]); }).join(' L '));
    this.guideDash.setAttribute('opacity', 0.55);
    // 笔尖
    this.guideTip.setAttribute('cx', tipY[0]);
    this.guideTip.setAttribute('cy', tipY[1]);
    this.guideTip.setAttribute('opacity', 1);
    // 收笔箭头
    if (p > 0.72) {
      var end = m[m.length - 1];
      var angD = endAngle(m);                 // 数据空间角度
      var angS = -angD;                       // 翻转后
      var ex = end[0], ey = 1024 - end[1];
      var rad = angS * Math.PI / 180;
      var bx = ex - 46 * Math.cos(rad), by = ey - 46 * Math.sin(rad);
      var px = -Math.sin(rad), py = Math.cos(rad);
      var d = 'M ' + ex + ' ' + ey +
        ' L ' + (bx + 22 * px) + ' ' + (by + 22 * py) +
        ' L ' + (bx - 22 * px) + ' ' + (by - 22 * py) + ' Z';
      this.guideArrow.setAttribute('d', d);
      this.guideArrow.setAttribute('opacity', p > 0.95 ? 0 : 0.95);
    } else {
      this.guideArrow.setAttribute('opacity', 0);
    }
  };

  StrokePlayer.prototype._setBadgePos = function (i) {
    var m = this.data.medians[i];
    var b = this.badges[i];
    var x = m[0][0], y = 1024 - m[0][1];
    // 向左上偏移，避免遮挡笔画
    var prev = i > 0 ? this.data.medians[i - 1][0] : null;
    var dx = -46, dy = -46;
    if (prev && Math.abs(1024 - prev[1] - y) < 60 && Math.abs(prev[0] - x) < 60) { dx = 46; }
    b.setAttribute('x', x + dx);
    b.setAttribute('y', y + dy);
  };

  StrokePlayer.prototype._tick = function (ts) {
    if (this.destroyed || !this.playing) return;
    if (!this._last) this._last = ts;
    var dt = Math.min(64, ts - this._last);
    this._last = ts;
    var i = this.cursor;
    if (i >= this.data.strokes.length) { this.playing = false; return; }
    if (this.gapLeft > 0) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 0) this._render();
    } else {
      var dur = this.durations[i] / this.speed;
      this.progress += dt / dur;
      if (this.progress >= 1) {
        this.progress = 1;
        this._finishStroke();
      } else {
        this._render();
      }
    }
    if (this.playing) this._raf = requestAnimationFrame(this._tickBind || (this._tickBind = this._tick.bind(this)));
  };

  StrokePlayer.prototype._finishStroke = function () {
    this.cursor++;
    this.progress = 0;
    this._setBadgePos(this.cursor - 1);
    if (this.cursor >= this.data.strokes.length) {
      this.playing = false;
      this._render();
      if (this.opts.onComplete) this.opts.onComplete();
      return;
    }
    if (this.stopAfter === this.cursor) {
      this.playing = false;
      this.stopAfter = -1;
      this._render();
      return;
    }
    this.gapLeft = 170 / this.speed;
    this._render();
  };

  /* ---- 对外控制 ---- */
  StrokePlayer.prototype.play = function () {
    if (this.cursor >= this.data.strokes.length) { this.replay(); return; }
    this.playing = true;
    this._last = 0;
    this._raf = requestAnimationFrame(this._tickBind || (this._tickBind = this._tick.bind(this)));
    this._render();
  };
  StrokePlayer.prototype.pause = function () {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._render();
  };
  StrokePlayer.prototype.toggle = function () { this.playing ? this.pause() : this.play(); };
  StrokePlayer.prototype.replay = function () {
    this.cursor = 0; this.progress = 0; this.gapLeft = 0; this.stopAfter = -1;
    for (var i = 0; i < this.badges.length; i++) this.badges[i].setAttribute('opacity', 0);
    this.playing = true;
    this._last = 0;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._tickBind || (this._tickBind = this._tick.bind(this)));
    this._render();
  };
  // 下一笔：动画中则立即完成当前笔并暂停；静止则单独演示下一笔
  StrokePlayer.prototype.stepNext = function () {
    if (this.cursor >= this.data.strokes.length) return;
    if (this.playing && this.progress > 0) {
      this.progress = 1;
      this.stopAfter = -1;
      this._finishStroke();
      this.pause();
    } else {
      this.stopAfter = this.cursor + 1;
      this.playing = true;
      this._last = 0;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(this._tickBind || (this._tickBind = this._tick.bind(this)));
      this._render();
    }
  };
  StrokePlayer.prototype.stepPrev = function () {
    this.pause();
    this.cursor = Math.max(0, this.cursor - 1);
    this.progress = 0;
    this._render();
  };
  StrokePlayer.prototype.setSpeed = function (s) {
    this.speed = s;
    if (this.gapLeft > 0) this.gapLeft = 170 / s;
  };
  StrokePlayer.prototype.isDone = function () { return this.cursor >= this.data.strokes.length; };
  StrokePlayer.prototype.destroy = function () {
    this.destroyed = true;
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this.container.innerHTML = '';
  };

  window.StrokePlayer = StrokePlayer;
})();
