/* 临摹练习：基于 hanzi-writer 的描红测验（笔顺/形状校验、实时反馈、评分） */
(function () {
  'use strict';

  var writer = null;
  var area = null;
  var current = null;
  var handlers = {
    onStatus: null,   // (msg, type) 实时反馈
    onProgress: null, // (done, total, mistakes, totalMistakes)
    onComplete: null  // ({totalMistakes, total})
  };

  function start(char, container, opts) {
    destroy();
    current = char;
    area = container;
    container.innerHTML = '';
    var size = Math.max(240, Math.min(480, container.clientWidth || 420));
    writer = HanziWriter.create(container, char, {
      width: size,
      height: size,
      padding: 12,
      showOutline: opts.outline !== false,
      leniency: opts.leniency || 1,
      strokeColor: '#5d6b84',
      outlineColor: '#eecfc6',
      highlightColor: '#f4a13d',
      drawingColor: '#d84343',
      strokeHighlightColor: '#d84343',
      showCharacterAfterComplete: false,
      charDataLoader: function (ch, onComplete) {
        DS.fetchChar(ch).then(function (d) {
          onComplete(d || null);
        }).catch(function () { onComplete(null); });
      }
    });
    writer.quiz({
      leniency: opts.leniency || 1,
      showHintAfterMisses: 2,
      onMistake: function (res) {
        var names = opts.strokeNames || [];
        var nm = names[res.strokeNum] ? '「' + names[res.strokeNum] + '」' : '这一笔';
        var msg;
        if (res.mistakes >= 2) msg = '再想想：' + nm + ' 的方向和位置，跟着闪烁的提示写一写';
        else msg = '这一笔不对哦，再试一次（' + nm + '）';
        if (handlers.onProgress) handlers.onProgress(res.strokeNum, opts.total, res.mistakes, res.totalMistakes);
        if (handlers.onStatus) handlers.onStatus(msg, 'err');
      },
      onCorrectStroke: function (res) {
        var names = opts.strokeNames || [];
        var nm = names[res.strokeNum] ? '「' + names[res.strokeNum] + '」' : '';
        var idx = res.strokeNum + 1;
        if (handlers.onProgress) handlers.onProgress(res.strokeNum + 1, opts.total, res.mistakes || 0, res.totalMistakes || 0);
        if (handlers.onStatus) handlers.onStatus('第' + idx + '笔' + nm + '，写得不错！', 'ok');
      },
      onComplete: function (res) {
        if (handlers.onComplete) handlers.onComplete({ totalMistakes: res.totalMistakes || 0, total: opts.total });
        if (handlers.onStatus) handlers.onStatus('太棒了，全部完成！', 'ok');
      }
    });
  }

  function destroy() {
    if (writer) { try { writer.cancelQuiz && writer.cancelQuiz(); } catch (e) { } }
    if (area) { try { area.innerHTML = ''; } catch (e) { } }
    writer = null;
    current = null;
  }

  function isReady() { return !!writer; }

  window.Practice = {
    start: start,
    destroy: destroy,
    isReady: isReady,
    setHandlers: function (h) { handlers = h; }
  };
})();
