import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const vendorDir = join(root, 'vendor', `dsh-pet-${pkg.dsh.desktopAdapter.upstreamVersion}`);

test('仓库根是一个可被官方桌面端管理的 bundle', async () => {
  assert.equal(pkg.name, 'dsh-pet');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './adapter/host.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-connection']);
  assert.equal(pkg.dsh.client.platform, 'web');
  await stat(join(root, pkg.dsh.bundle.patch));
});

test('兼容矩阵覆盖官方桌面端 0.2.1-rc.1', () => {
  const releases = pkg.dsh.compatibility.dshReleases;
  assert.equal(releases['0.2.1-rc.1'], 'compatible');
  assert.equal(releases['0.2.0-rc.2'], 'compatible');
  assert.equal(releases['0.1.7-rc.2'], 'incompatible');
});

test('bundle patch 的 entry id/name 与包名一致，id 行没有行尾注释', async () => {
  const yml = await readFile(join(root, pkg.dsh.bundle.patch), 'utf8');
  assert.match(yml, /^- insert:/m);
  assert.match(yml, /^ {4}- id: dsh-pet$/m);
  assert.match(yml, /^ {6}name: 'dsh-pet'$/m);
  assert.equal(
    yml.split('\n').find((line) => /^\s*-?\s*id:\s*dsh-pet\s+#/.test(line)),
    undefined,
    'id 行不能写行尾注释（商城预检会抓不到 entry id）',
  );
});

test('exports 全部指向真实文件', async () => {
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (key === './package.json') continue;
    assert.equal(typeof target, 'string', key);
    await stat(join(root, target));
  }
});

test('icon 在包目录内且不超过 256 KiB', async () => {
  const icon = resolve(root, pkg.icon);
  assert.ok(icon.startsWith(resolve(root) + sep), 'icon 必须留在包目录内');
  const info = await stat(icon);
  assert.ok(info.isFile());
  assert.ok(info.size <= 256 * 1024, `icon ${info.size} bytes > 256 KiB`);
});

test('vendor 产物与 manifest 一致，补丁锚点与懒加载改造齐全', async () => {
  const manifest = JSON.parse(await readFile(join(vendorDir, 'vendor-manifest.json'), 'utf8'));
  assert.equal(manifest.upstream.version, pkg.dsh.desktopAdapter.upstreamVersion);
  const names = Object.keys(manifest.files);
  assert.ok(names.includes('lib/index.js'));
  assert.ok(names.includes('lib/client.js'));
  assert.ok(names.includes('runtime/electron-helper/shared-core.js'));
  for (const [file, hash] of Object.entries(manifest.files)) {
    const buffer = await readFile(join(vendorDir, file));
    assert.equal(createHash('sha256').update(buffer).digest('hex'), hash, file);
  }
  const lib = await readFile(join(vendorDir, 'lib/index.js'), 'utf8');
  assert.ok(lib.includes('new URL("../../../dsh-pet/", import.meta.url)'), '素材根补丁缺失');
  assert.equal(lib.split('new URL("..", import.meta.url)').length - 1, 0, '素材根补丁重复或残留旧锚点');
  assert.equal(/^import \{ downloadArtifact \} from "@electron\/get";$/m.test(lib), false, '顶层 @electron/get 静态导入必须删除（link: 安装缺依赖会拖死整个插件）');
  assert.ok(lib.includes('async function loadElectronDownloader()'), '缺 @electron/get 懒加载器');
  assert.ok(lib.includes('async function loadZipExtractor()'), '缺 extract-zip 懒加载器');
  assert.ok(lib.includes('const downloadArtifact = await loadElectronDownloader();'), '下载路径未改为懒加载');
  assert.deepEqual(manifest.patches.map((patch) => patch.name), ['asset-root', 'lazy-download-loaders', 'drop-static-electron-import', 'drop-dynamic-zip-import']);
});

test('浏览器半边的模块 id 与包名一致', async () => {
  const client = await readFile(join(root, pkg.exports['./client']), 'utf8');
  assert.ok(client.includes('window.__ModuleLoader__.load({'));
  assert.match(client, /id:\s*"dsh-pet"/);
});
