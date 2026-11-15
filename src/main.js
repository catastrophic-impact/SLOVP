const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const { createDeps } = require('./deps');
const fs = require('fs');
const path = require('path');

// SLOVP = Simple Local Online Video Player: a thin shell with two tabs, YouTube (the SLYTP code) and Rumble (the SLRVP code).
// Each tab is its own view with its own backend module (src/youtube, src/rumble). A tab is created the first time it is
// pressed, and the tab you leave is suspended: hidden, told to stop, its pending requests and helper processes dropped.
const TAB_BAR = 44;
app.commandLine.appendSwitch('no-sandbox');
// Portable: all app data lives in ./config next to the AppImage (or the project in dev), never in ~/.config.
const dataDir = process.env.APPIMAGE ? path.join(path.dirname(process.env.APPIMAGE), 'config') : path.join(__dirname, '..', 'config');
app.setPath('userData', dataDir);

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
const shellFile = () => path.join(dataDir, 'shell.json');

let win = null;
const tabs = {
  youtube: { title: 'YouTube', dir: 'youtube', view: null, api: null, suspended: false },
  rumble: { title: 'Rumble', dir: 'rumble', view: null, api: null, suspended: false },
};
let active = null;
const sendTo = (t, ch, payload) => { const v = t.view; if (v && !v.webContents.isDestroyed()) v.webContents.send(ch, payload); };
const sendShell = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// One yt-dlp / ffmpeg manager shared by both tabs (they are the same binaries); status goes to whichever tabs exist.
const bundledYtdlp = path.join(process.resourcesPath || '', 'bin', 'yt-dlp');
const deps = createDeps({
  binDir: path.join(dataDir, 'bin'),
  bundledYtdlp: app.isPackaged ? bundledYtdlp : null,
  readJson, writeJson,
  onStatus: (st) => Object.values(tabs).forEach((t) => sendTo(t, 'ytdlp-status', st)),
  onFfmpegProgress: (p) => Object.values(tabs).forEach((t) => sendTo(t, 'ffmpeg-progress', p)),
});

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  for (const t of Object.values(tabs)) t.view?.setBounds({ x: 0, y: TAB_BAR, width: w, height: Math.max(0, h - TAB_BAR) });
}

// Builds the tab's view and backend the first time it is needed; nothing of it exists before that.
function createTab(name) {
  const t = tabs[name];
  const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, t.dir, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  t.view = view;
  win.contentView.addChildView(view);
  t.api = require(`./${t.dir}/main.js`)({ send: (ch, p) => sendTo(t, ch, p), win: () => win, deps, readJson, writeJson, dataDir });
  layout();
  view.webContents.loadFile(path.join(__dirname, t.dir, 'renderer', 'index.html'));
}

function showTab(name) {
  if (!tabs[name] || name === active) return;
  const prev = active && tabs[active];
  if (prev) { prev.view.setVisible(false); sendTo(prev, 'suspend'); prev.api.suspend(); prev.suspended = true; }
  const t = tabs[name];
  const fresh = !t.view;
  if (fresh) createTab(name);
  t.view.setVisible(true);
  if (!fresh && t.suspended) { t.api.resume(); t.suspended = false; sendTo(t, 'resume'); }
  active = name;
  layout();
  t.view.webContents.focus();
  try { writeJson(shellFile(), { tab: name }); } catch {}
  sendShell('active-tab', name);
}

ipcMain.handle('shell:switch', (_e, name) => { showTab(name); return active; });
ipcMain.handle('shell:state', () => ({ active, tabs: Object.entries(tabs).map(([id, t]) => ({ id, title: t.title })) }));

app.whenReady().then(async () => {
  await session.defaultSession.clearCache().catch(() => {}); // the UI is local files: never keep a stale app.js/style.css
  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#0f0f12', title: 'SLOVP', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'shell', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.on('resize', layout);
  await win.loadFile(path.join(__dirname, 'shell', 'index.html'));
  const last = readJson(shellFile(), {}).tab;
  showTab(tabs[last] ? last : 'youtube');
  deps.updateYtdlp(); // background: seeds config/bin/yt-dlp, then checks GitHub at most once a day
});
app.on('window-all-closed', () => { tabs.rumble.api?.close?.(); app.quit(); });
