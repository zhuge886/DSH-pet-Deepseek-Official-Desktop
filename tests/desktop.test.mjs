import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  ADAPTER_ID,
  DOWNLOAD_DEPENDENCIES,
  HEALTH_PATH,
  UPSTREAM_VERSION,
  createDesktopAdapter,
  desktopRuntimePlan,
  detectHost,
  electronCandidates,
  electronRelativePath,
  helperEnvHazards,
  probeDownloadDependencies,
  resolveDshHome,
  sanitizedHelperEnv,
} from '../adapter/desktop.js';

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? {};
    },
    end(body) {
      this.body = body;
    },
  };
}

function fakeContext() {
  const routes = [];
  const registeredCommands = [];
  const disposers = [];
  return {
    routes,
    registeredCommands,
    disposers,
    logger: { info() {}, warn() {}, error() {} },
    webServer: {
      port: 0,
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    commands: { register(definition) { registeredCommands.push(definition); return () => {}; } },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); },
    on() { return () => {}; },
    get() { return undefined; },
    credentials: { resolve: async () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) },
    connection: { authenticatedUrl: (url) => url },
  };
}

test('平台可执行文件相对路径与上游一致', () => {
  assert.equal(electronRelativePath('win32'), 'electron.exe');
  assert.equal(electronRelativePath('darwin'), 'Electron.app\\Contents\\MacOS\\Electron');
  assert.equal(electronRelativePath('linux'), 'electron');
});

test('DSH home 解析遵循 DSH_HOME 优先', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'D:\\dsh-home', USERPROFILE: 'C:\\Users\\u' }), 'D:\\dsh-home');
  assert.equal(resolveDshHome({ USERPROFILE: 'C:\\Users\\u' }), 'C:\\Users\\u\\.dsh');
  assert.equal(resolveDshHome({ HOME: '/home/u' }), join('/home/u', '.dsh'));
});

test('宿主识别：官方桌面 / dsh web', () => {
  const desktop = detectHost({
    versions: { electron: '44.0.0', node: '24.21.0' },
    env: { DSH_HOME: 'D:\\h', DSH_CLIENT_VERSION: '0.2.1-rc.1', DSH_PROFILE: 'web' },
    platform: 'win32',
  });
  assert.equal(desktop.kind, 'desktop');
  assert.equal(desktop.electronVersion, '44.0.0');
  assert.equal(desktop.officialDesktopShell, true);
  assert.equal(desktop.clientVersion, '0.2.1-rc.1');
  assert.equal(desktop.profile, 'web');
  assert.equal(desktop.platform, 'win32');

  const web = detectHost({ versions: { node: '24.21.0' }, env: { USERPROFILE: 'C:\\Users\\u' }, platform: 'win32' });
  assert.equal(web.kind, 'web');
  assert.equal(web.electronVersion, null);
  assert.equal(web.officialDesktopShell, false);
  assert.equal(web.clientVersion, null);
});

test('Electron 候选顺序：环境变量 → DSH_HOME → npm，且去重', () => {
  const candidates = electronCandidates({
    env: { DSH_PET_ELECTRON_PATH: 'D:\\custom\\electron.exe', DSH_HOME: 'D:\\h' },
    platform: 'win32',
    exists: (path) => path === 'D:\\h\\electron\\electron.exe',
    requireElectron: () => 'C:\\npm\\electron.exe',
  });
  assert.deepEqual(candidates.map((item) => item.source), ['DSH_PET_ELECTRON_PATH', 'dsh-home', 'npm-electron']);
  assert.equal(candidates[1].exists, true);

  const deduped = electronCandidates({
    env: { DSH_HOME: 'D:\\h' },
    platform: 'win32',
    exists: () => false,
    requireElectron: () => 'D:\\h\\electron\\electron.exe',
  });
  assert.equal(deduped.length, 1, '同一路径只保留第一次出现的来源');
});

test('环境风险：ELECTRON_RUN_AS_NODE 与带预加载的 NODE_OPTIONS', () => {
  assert.deepEqual(helperEnvHazards({ PATH: 'x' }), []);
  const hazards = helperEnvHazards({ ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require ./hook.cjs' });
  assert.deepEqual(hazards.map((hazard) => hazard.name), ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']);
  assert.equal(helperEnvHazards({ NODE_OPTIONS: '--max-old-space-size=4096' }).length, 0);
});

test('干净 helper 环境不修改入参', () => {
  const input = { PATH: 'x', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--import ./x.mjs' };
  const output = sanitizedHelperEnv(input);
  assert.equal('ELECTRON_RUN_AS_NODE' in output, false);
  assert.equal('NODE_OPTIONS' in output, false);
  assert.equal(output.PATH, 'x');
  assert.equal(input.ELECTRON_RUN_AS_NODE, '1');
});

test('下载依赖探测：缺依赖时 ready=false 但不抛错', () => {
  assert.deepEqual(DOWNLOAD_DEPENDENCIES, ['@electron/get', '@electron-internal/extract-zip']);
  const ready = probeDownloadDependencies({ resolve: () => 'resolved' });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
  const missing = probeDownloadDependencies({
    resolve(name) {
      if (name === '@electron/get') throw new Error('ERR_MODULE_NOT_FOUND');
      return 'resolved';
    },
  });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, ['@electron/get']);
});

test('桌面运行时方案：命中已有二进制 / 需要下载', () => {
  const found = desktopRuntimePlan({
    env: { DSH_HOME: 'D:\\h' },
    platform: 'win32',
    exists: (path) => path.endsWith('electron.exe'),
    requireElectron: () => undefined,
    downloadDependencies: { resolve: () => 'resolved' },
  });
  assert.equal(found.downloadDependencies.ready, true);
  assert.equal(found.requiresDownload, false);
  assert.equal(found.source, 'dsh-home');
  assert.equal(found.downloadRoot, 'D:\\h\\electron');

  const missing = desktopRuntimePlan({ env: { DSH_HOME: 'D:\\h' }, platform: 'win32', exists: () => false, requireElectron: () => undefined });
  assert.equal(missing.requiresDownload, true);
  assert.equal(missing.electronPath, null);
  assert.equal(typeof missing.downloadDependencies.ready, 'boolean');
});

test('健康检查：GET 返回快照，POST 405，失败可观测', async () => {
  const ctx = fakeContext();
  const adapter = createDesktopAdapter(ctx, {
    host: { versions: { electron: '44.0.0', node: '24.21.0' }, env: { DSH_HOME: 'D:\\h' }, platform: 'win32' },
    runtime: { env: { DSH_HOME: 'D:\\h' }, platform: 'win32', exists: () => false, requireElectron: () => undefined },
  });
  adapter.installHealthRoute();
  assert.equal(adapter.state.health.registered, true);

  const route = ctx.routes.find((item) => item.path === HEALTH_PATH);
  assert.equal(route.kind, 'exact');
  const res = fakeResponse();
  route.handler({ method: 'GET' }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.adapter.id, ADAPTER_ID);
  assert.equal(body.adapter.upstream, UPSTREAM_VERSION);
  assert.equal(body.host.kind, 'desktop');
  assert.equal(body.runtime.requiresDownload, true);

  const rejected = fakeResponse();
  route.handler({ method: 'POST' }, rejected);
  assert.equal(rejected.status, 405);

  adapter.markFailed(new Error('boom'));
  const failed = fakeResponse();
  route.handler({ method: 'GET' }, failed);
  assert.equal(JSON.parse(failed.body).ok, false);
  assert.equal(JSON.parse(failed.body).upstream.error, 'boom');
});

test('健康检查可以被关闭', () => {
  const ctx = fakeContext();
  const adapter = createDesktopAdapter(ctx, { healthRoute: false });
  adapter.installHealthRoute();
  assert.equal(adapter.state.health.registered, false);
  assert.equal(ctx.routes.length, 0);
});
