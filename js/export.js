/* 动画导出：自包含 SVG（CSS 循环动画）与 WebM 视频（Canvas + MediaRecorder） */
(function () {
  'use strict';

  var LEAD = 500, GAP = 170, TAIL = 2200, HOLD = 700; // ms

  function timing(data) {
    var t = [], cur = LEAD;
    for (var i = 0; i < data.strokes.length; i++) {
      var m = data.medians[i];
      var L = 0;
      for (var j = 1; j < m.length; j++) L += Math.hypot(m[j][0] - m[j - 1][0], m[j][1] - m[j - 1][1]);
      var dur = Math.max(300, Math.min(1500, 260 + L * 1.05));
      t.push({ start: cur, dur: dur, len: L });
      cur += dur + GAP;
    }
    t.total = cur + TAIL;
    return t;
  }
  function medPath(m) {
    return 'M ' + m.map(function (p) { return p[0] + ' ' + (1024 - p[1]); }).join(' L ');
  }
  function medPathData(m) {
    return 'M ' + m.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L ');
  }

  /* ---------------- SVG 导出 ---------------- */
  function buildSVG(char, data, names, pinyin) {
    var t = timing(data);
    var total = t.total;
    var n = data.strokes.length;
    var css = '';
    var defs = '';
    var ghost = '', strokesBody = '', guideBody = '', badges = '';

    for (var i = 0; i < n; i++) {
      var s = t[i];
      var p0 = (s.start / total * 100).toFixed(2);
      var p1 = ((s.start + s.dur) / total * 100).toFixed(2);
      var p2 = (100).toFixed(2);
      // 揭示动画（dashoffset）
      css += '@keyframes un' + i + '{0%,' + p0 + '%{stroke-dashoffset:' + s.len.toFixed(0) + ';}' + p1 + '%,100%{stroke-dashoffset:0;}}\n';
      css += '.lm' + i + '{animation:un' + i + ' ' + total + 'ms linear infinite;}\n';
      // 透明度：0 -> 1 -> 半透明
      css += '@keyframes op' + i + '{0%,' + p0 + '%{opacity:0;}' + (parseFloat(p1) + 0.01).toFixed(2) + '%{opacity:1;}' + (parseFloat(p1) + 2).toFixed(2) + '%,100%{opacity:.38;}}\n';
      css += '.st' + i + '{animation:op' + i + ' ' + total + 'ms linear infinite;}\n';
      // 引导虚线
      css += '@keyframes gd' + i + '{0%,' + p0 + '%{opacity:0;}' + (parseFloat(p0) + 1).toFixed(2) + '%{opacity:.55;}' + p1 + '%,' + (parseFloat(p1) + 1.5).toFixed(2) + '%,100%{opacity:0;}}\n';
      css += '.gu' + i + '{animation:gd' + i + ' ' + total + 'ms linear infinite;}\n';

      defs += '<mask id="m' + i + '" x="0" y="0" width="1024" height="1024" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">' +
        '<polyline class="lm' + i + '" points="' + data.medians[i].map(function (p) { return p[0] + ',' + p[1]; }).join(' ') +
        '" fill="none" stroke="#fff" stroke-width="210" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="' + s.len.toFixed(0) + '" stroke-dashoffset="' + s.len.toFixed(0) + '"/></mask>';

      ghost += '<path d="' + data.strokes[i] + '" fill="#eee5cf"/>';
      strokesBody += '<path class="st' + i + '" d="' + data.strokes[i] + '" fill="#d84343" mask="url(#m' + i + ')" opacity="0"/>';
      guideBody += '<path class="gu' + i + '" d="' + medPath(data.medians[i]) + '" fill="none" stroke="#e5938b" stroke-width="9" stroke-dasharray="3 15" stroke-linecap="round" opacity="0"/>';

      var st0 = data.medians[i][0];
      badges += '<g class="bg' + i + '" opacity="0"><circle cx="' + (st0[0] - 42) + '" cy="' + (1024 - st0[1] - 42) + '" r="34" fill="#f7efe0" stroke="#b98a2f" stroke-width="4"/>' +
        '<text x="' + (st0[0] - 42) + '" y="' + (1024 - st0[1] - 42) + '" font-size="42" font-weight="700" fill="#8a6a1f" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">' + (i + 1) + '</text></g>';
      var bp1 = (parseFloat(p1) + 0.01).toFixed(2);
      css += '@keyframes bd' + i + '{0%,' + p1 + '%{opacity:0;}' + bp1 + '%,100%{opacity:1;}}\n.bg' + i + '{animation:bd' + i + ' ' + total + 'ms linear infinite;}\n';
    }

    var label = char + (pinyin ? ' · ' + pinyin : '') + ' · ' + n + '画';
    var nameStr = (names || []).join('、');

    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -150 1024 1250" width="640" height="781">' +
      '<defs><style>' + css + '</style>' + defs + '</defs>' +
      '<rect x="0" y="-150" width="1024" height="1250" fill="#fffdf7"/>' +
      '<text x="512" y="-58" font-size="64" fill="#c84437" text-anchor="middle" font-family="KaiTi,STKaiti,serif">' + label + '</text>' +
      '<rect x="8" y="8" width="1008" height="1008" rx="6" fill="none" stroke="#d9cdb4" stroke-width="3"/>' +
      '<line x1="512" y1="8" x2="512" y2="1016" stroke="#e2d7bd" stroke-width="2" stroke-dasharray="14 12"/>' +
      '<line x1="8" y1="512" x2="1016" y2="512" stroke="#e2d7bd" stroke-width="2" stroke-dasharray="14 12"/>' +
      '<line x1="8" y1="8" x2="1016" y2="1016" stroke="#eee6d2" stroke-width="2" stroke-dasharray="10 16"/>' +
      '<line x1="1016" y1="8" x2="8" y2="1016" stroke="#eee6d2" stroke-width="2" stroke-dasharray="10 16"/>' +
      '<g transform="translate(0,1024) scale(1,-1)">' + ghost + strokesBody + '</g>' +
      guideBody + badges +
      '<text x="512" y="1080" font-size="30" fill="#9aa0ae" text-anchor="middle" font-family="sans-serif">笔顺：' + nameStr + '</text>' +
      '<text x="512" y="1118" font-size="24" fill="#c9c2b0" text-anchor="middle" font-family="sans-serif">一笔一画 · 汉字笔顺教学 · 依据《现代汉语通用字笔顺规范》</text>' +
      '</svg>';
    return svg;
  }

  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1500);
  }

  function exportSVG(char, data, names, pinyin) {
    var svg = buildSVG(char, data, names, pinyin);
    downloadBlob(svg, '笔顺-' + char + '.svg', 'image/svg+xml;charset=utf-8');
  }

  /* ---------------- WebM 导出 ---------------- */
  function exportWebM(char, data, names, pinyin, onStatus) {
    return new Promise(function (resolve, reject) {
      if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
        reject(new Error('当前浏览器不支持视频录制，请改用 SVG 导出'));
        return;
      }
      var S = 720, scale = S / 1024;
      var canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      var ctx = canvas.getContext('2d');
      var t = timing(data);
      var total = t.total + HOLD;
      var off = document.createElement('canvas');
      off.width = S; off.height = S;
      var octx = off.getContext('2d');

      var stream = canvas.captureStream(30);
      var mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      var mime = mimes[0];
      for (var i = 0; i < mimes.length; i++) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mimes[i])) { mime = mimes[i]; break; }
      }
      var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3200000 });
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: 'video/webm' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '笔顺-' + char + '.webm';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        resolve();
      };
      rec.onerror = function (e) { reject(new Error('录制失败')); };

      function drawMedUpTo(c, m, dist, width) {
        c.lineWidth = width * scale;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.strokeStyle = '#fff';
        c.beginPath();
        var acc = 0;
        c.moveTo(m[0][0], m[0][1]);
        for (var j = 1; j < m.length; j++) {
          var dx = m[j][0] - m[j - 1][0], dy = m[j][1] - m[j - 1][1];
          var seg = Math.hypot(dx, dy);
          if (acc + seg <= dist) { c.lineTo(m[j][0], m[j][1]); acc += seg; }
          else {
            var k = (dist - acc) / seg;
            c.lineTo(m[j - 1][0] + dx * k, m[j - 1][1] + dy * k);
            break;
          }
        }
        c.stroke();
      }

      function frame(time) {
        var tt = time;
        var active = -1, prog = 0;
        for (var i = 0; i < t.length; i++) {
          if (tt >= t[i].start && tt < t[i].start + t[i].dur) { active = i; prog = (tt - t[i].start) / t[i].dur; break; }
        }
        // 背景
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fffdf7';
        ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = '#d9cdb4'; ctx.lineWidth = 3;
        ctx.strokeRect(8 * scale, 8 * scale, 1008 * scale, 1008 * scale);
        ctx.setLineDash([14, 12]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(S / 2, 8 * scale); ctx.lineTo(S / 2, 1016 * scale); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(8 * scale, S / 2); ctx.lineTo(1016 * scale, S / 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // 字形（数据坐标 y 上 → 翻转到屏幕）
        ctx.save();
        ctx.setTransform(scale, 0, 0, -scale, 0, S);
        var fillPath = function (d, color, alpha) {
          var p = new Path2D(d);
          ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(p); ctx.globalAlpha = 1;
        };
        for (var k = 0; k < t.length; k++) {
          if (k === active) continue;
          if (tt >= t[k].start + t[k].dur) fillPath(data.strokes[k], '#5d6b84', 0.4);
        }
        if (active >= 0) {
          // 当前笔画：满画 + 蒙版合成
          octx.setTransform(1, 0, 0, 1, 0, 0);
          octx.clearRect(0, 0, S, S);
          octx.setTransform(scale, 0, 0, -scale, 0, S);
          octx.fillStyle = '#d84343';
          octx.fill(new Path2D(data.strokes[active]));
          octx.globalCompositeOperation = 'destination-in';
          octx.setTransform(scale, 0, 0, -scale, 0, S);
          drawMedUpTo(octx, data.medians[active], t[active].len * easeIO(prog), 210);
          octx.globalCompositeOperation = 'source-over';
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(off, 0, 0);
        }
        ctx.restore();

        // 笔画编号
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = '700 30px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (var b = 0; b < t.length; b++) {
          if (tt >= t[b].start + t[b].dur) {
            var st = data.medians[b][0];
            ctx.fillStyle = '#8a6a1f';
            ctx.fillText(String(b + 1), (st[0] - 42) * scale, S - (st[1] + 42) * scale);
          }
        }
      }

      function easeIO(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

      var startTs = 0;
      function loop(ts) {
        if (!startTs) startTs = ts;
        var time = ts - startTs;
        frame(time);
        if (onStatus) onStatus(Math.min(99, Math.round(time / total * 100)));
        if (time < total) requestAnimationFrame(loop);
        else {
          if (onStatus) onStatus(100);
          setTimeout(function () { try { rec.stop(); } catch (e) { reject(e); } }, 250);
        }
      }
      frame(0);
      rec.start(120);
      requestAnimationFrame(loop);
    });
  }

  window.Exporter = {
    exportSVG: exportSVG,
    exportWebM: exportWebM
  };
})();
