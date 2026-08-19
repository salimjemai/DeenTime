import http from 'node:http';

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:4300');
  const src = escapeHtml(url.searchParams.get('src') ?? 'http://127.0.0.1:4200/w/iqamatime-demo-mosque');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><title>External host</title><iframe title="IqamaTime external-origin test" src="${src}" style="width:430px;height:920px;border:0"></iframe>`);
});
server.listen(4300, '127.0.0.1');
