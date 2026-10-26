// 简易静态文件服务器（本地使用 + 局域网共享给手机/平板）
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.join(__dirname, '..');
var PORT = parseInt(process.argv[2], 10) || 8420;
var HOST = '0.0.0.0'; // 监听所有网卡，同一 Wi-Fi 下的手机/平板均可访问
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'video/webm'
};

http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('Not Found: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, HOST, function () {
  console.log('一笔一画 笔顺教学服务已启动');
  console.log('  本机访问:   http://127.0.0.1:' + PORT + '/');
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (n) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log('  手机/平板:  http://' + n.address + ':' + PORT + '/  (需与电脑同一 Wi-Fi)');
      }
    });
  });
  console.log('  按 Ctrl+C 停止服务');
});
