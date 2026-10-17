import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function peersAvailable() {
  try {
    await import('@deepseek-ai/dsh-home-paths');
    await import('@deepseek-ai/dsh-credentials');
    await import('@deepseek-ai/dsh-llm');
    return true;
  } catch {
    return false;
  }
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
      register(route) { routes.push(route); return () => {}; },
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

/**
 * 把 DSH_HOME 指向仓库内临时目录，并写一份 display=web 的用户配置：
 * 这样 apply 只会注册路由/命令，不会触发 Electron 下载或 spawn。
 */
async function prepareHome() {
  const home = join(root, '.tmp', 'boot-home');
  await rm(home, { recursive: true, force: true });
  await mkdir(join(home, 'dsh-pet'), { recursive: true });
  const config = await readFile(join(root, 'dsh-pet', 'assets', 'config.jsonc'), 'utf8');
  const webOnly = config.replaceAll('"display": "both"', '"display": "web"').replaceAll('"whisperEnabled": true', '"whisperEnabled": false');
  assert.notEqual(webOnly, config, '默认配置里应有 display: both');
  await writeFile(join(home, 'dsh-pet', 'main-config.jsonc'), webOnly, 'utf8');
  return home;
}

test('适配入口能在 DSH 0.2.1-rc.1 的 peer 上完成初始化（不触发下载）', async (t) => {
  if (!(await peersAvailable())) {
    t.skip('未安装 @deepseek-ai/dsh-* peer 依赖（在 DSH profile 内或 npm install 后运行）');
    return;
  }
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = await prepareHome();
  try {
    const host = await import('../adapter/host.js');
    assert.equal(host.name, 'pet');
    assert.deepEqual(host.inject, ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection']);
    assert.equal(typeof host.apply, 'function');

    const ctx = fakeContext();
    host.apply(ctx, { desktopAdapter: { resilient: true, healthRoute: true } });

    const paths = ctx.routes.map((route) => route.path);
    assert.ok(paths.includes('/dsh-pet-7340'), '上游桌宠路由未注册：' + paths.join(', '));
    assert.ok(paths.includes('/dsh-pet-desktop/health'), '适配层健康检查未注册：' + paths.join(', '));
    assert.equal(ctx.registeredCommands.length, 3);

    const healthRoute = ctx.routes.find((route) => route.path === '/dsh-pet-desktop/health');
    const res = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    healthRoute.handler({ method: 'GET' }, res);
    const health = JSON.parse(res.body);
    assert.equal(health.ok, true, JSON.stringify(health, null, 2));
    assert.equal(health.upstream.applied, true, JSON.stringify(health.upstream));
    assert.ok(health.runtime.downloadDependencies, '缺少下载依赖诊断字段');
    assert.ok(Array.isArray(health.runtime.downloadDependencies.missing));

    for (const dispose of ctx.disposers) dispose();
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
});
