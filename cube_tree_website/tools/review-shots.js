// Screenshots of the site in headless Chrome (Chrome DevTools Protocol), for
// design reviews (README "Design review").
// usage: node tools/review-shots.js <outdir> [tag]     THEME=dark for the dark theme
// Serve the site first: `python3 -m http.server 8765` in cube_tree_website/.
// Shots: sign-in, solver (viewport and full page), Options, algs page, phone width.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'cubetree-shots');
const TAG = process.argv[3] || 'cur';
const BASE = 'http://127.0.0.1:8765/';
const PORT = 9333 + Math.floor(Math.random() * 400);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const udd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cubetree-chrome-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`,
    '--hide-scrollbars', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  async function viewport(w, h, mobile = false) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  }
  async function nav(url, wait = 2500) {
    await send('Page.navigate', { url: 'about:blank' }); await sleep(200);
    await send('Page.navigate', { url: BASE + url }); await sleep(wait);
  }
  async function shot(name, full = true) {
    let clip;
    if (full) {
      const m = await send('Page.getLayoutMetrics');
      const cs = m.result.cssContentSize || m.result.contentSize;
      clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.min(Math.ceil(cs.height), 4000), scale: 1 };
    }
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full, ...(clip ? { clip } : {}) });
    const f = path.join(OUT, `${TAG}-${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    console.log(f);
  }

  const theme = process.env.THEME || 'light';
  await viewport(1440, 900);
  // 1. first visit: onboarding / sign-in
  await nav('index.html'); await evaluate('localStorage.clear()'); await nav('index.html');
  await shot('01-index');
  // 2. a signed-in, onboarded profile
  await evaluate(`(function(){ const p = cubeProfiles.create({ name: 'rick', onboarded: true, answers: {}, prefs: { theme: '${theme}' } }); return p.id; })()`);
  await nav('solver.html', 15000);
  await shot('02-solver', false);
  // type a step into the solution bar to show the editor working
  await evaluate(`(async function(){ const t = document.getElementById('solution-input'); if (!t) return; t.focus(); })()`);
  await shot('03-solver-full');
  // 3. settings drawer
  await evaluate(`document.getElementById('settings-btn') && document.getElementById('settings-btn').click()`);
  await sleep(700);
  await shot('04-settings', false);
  // 4. algs page
  await nav('algs.html', 4000);
  await shot('05-algs', false);
  // 5. phone width
  await viewport(390, 844, true);
  await nav('solver.html', 8000);
  await shot('06-solver-phone');
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  ws.close(); chrome.kill('SIGKILL');
  fs.rmSync(udd, { recursive: true, force: true });
}
main().catch(e => { console.error(e); process.exit(1); });
