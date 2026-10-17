#!/usr/bin/env node
/**
 * 同步上游已构建产物到 vendor/ —— 让「官方桌面端适配发行版」保持免构建可安装。
 *
 * 用法：
 *   node scripts/sync-vendor.mjs                  # 版本取 package.json 的 dsh.desktopAdapter.upstreamVersion
 *   node scripts/sync-vendor.mjs --version 0.3.8  # 指定版本（必须已发布到 npm）
 *
 * 做的事：
 *   1. 从 npm registry 读取 dsh-pet@<version> 的 tarball 与 integrity；
 *   2. 只解出 lib/index.js、lib/client.js、runtime/、package.json、LICENSE；
 *   3. 打一个可审计的补丁：PACKAGE_ROOT 指向仓库内 dsh-pet/（复用 assets，避免 webm 重复入库）；
 *   4. 写 vendor-manifest.json（逐文件 SHA-256）与 PATCHES.md。
 *
 * 退出码非 0 表示校验失败；任何一步失败都不会留下半成品（先写临时目录再 rename）。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const version = (() => {
  const at = args.indexOf('--version');
  const fromArgs = at >= 0 ? args[at + 1] : undefined;
  const value = fromArgs ?? rootManifest.dsh?.desktopAdapter?.upstreamVersion;
  if (!value) throw new Error('缺少版本：--version <x.y.z> 或 package.json dsh.desktopAdapter.upstreamVersion');
  return value;
})();

const registry = process.env.DSH_PET_REGISTRY?.replace(/\/$/, '') ?? 'https://registry.npmjs.org';
const metaUrl = `${registry}/dsh-pet/${version}`;
console.log('[sync-vendor] registry:', metaUrl);

const meta = await (await fetch(metaUrl, { headers: { accept: 'application/json' } })).json();
if (!meta || meta.version !== version || !meta.dist?.tarball) {
  throw new Error(`registry 未返回 dsh-pet@${version} 的 tarball`);
}
const tarballUrl = meta.dist.tarball;
console.log('[sync-vendor] tarball:', tarballUrl);

const response = await fetch(tarballUrl);
if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
const tarball = Buffer.from(await response.arrayBuffer());
if (meta.dist.integrity?.startsWith('sha512-')) {
  const actual = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
  if (actual !== meta.dist.integrity) throw new Error('tarball integrity 校验失败');
  console.log('[sync-vendor] integrity ok');
}

const tar = gunzipSync(tarball);
const entries = [];
const cstr = (buffer, start, length) => {
  const slice = buffer.subarray(start, start + length);
  const zero = slice.indexOf(0);
  return slice.subarray(0, zero < 0 ? length : zero).toString('utf8');
};
for (let offset = 0; offset + 512 <= tar.length; ) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every((byte) => byte === 0)) break;
  const name = cstr(header, 0, 100);
  const size = Number.parseInt(cstr(header, 124, 12).trim() || '0', 8) || 0;
  const type = String.fromCharCode(header[156]);
  const prefix = cstr(header, 345, 155);
  const full = (prefix ? prefix + '/' + name : name).replace(/^package\//, '');
  const dataStart = offset + 512;
  if (full && type !== '5') entries.push({ name: full, data: tar.subarray(dataStart, dataStart + size) });
  offset = dataStart + Math.ceil(size / 512) * 512;
}

const wanted = entries.filter(({ name }) =>
  name === 'package.json' || name === 'LICENSE' || name === 'lib/index.js' || name === 'lib/client.js' || name.startsWith('runtime/'),
);
if (wanted.length < 10) throw new Error(`tarball 内容异常：只匹配到 ${wanted.length} 个文件`);

const packageRoot = join(root, 'vendor', `dsh-pet-${version}`);
const staging = packageRoot + '.staging';
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const { name, data } of wanted) {
  const destination = join(staging, name);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

const libPath = join(staging, 'lib', 'index.js');
let lib = await readFile(libPath, 'utf8');

/**
 * 应用一处锚点补丁，要求锚点恰好出现 count 次；上游产物格式变化时立即失败。
 * @param name - 补丁名（写进 vendor-manifest.json）。
 * @param search - 原文锚点。
 * @param replace - 替换文本。
 */
function applyPatch(name, search, replace) {
  const occurrences = lib.split(search).length - 1;
  if (occurrences !== 1) {
    throw new Error(`补丁 ${name} 的锚点数量为 ${occurrences}（预期 1），上游产物可能变了，请人工复核`);
  }
  lib = lib.replace(search, replace);
}

/**
 * 对 `lib/` 之外的文件（如 runtime 的共享纯逻辑）应用一处锚点补丁。
 * @param name - 补丁名（写进 vendor-manifest.json）。
 * @param file - 相对 vendor 根的路径。
 * @param search - 原文锚点。
 * @param replace - 替换文本。
 */
async function applyFilePatch(name, file, search, replace) {
  const target = join(staging, file);
  const source = await readFile(target, 'utf8');
  const occurrences = source.split(search).length - 1;
  if (occurrences !== 1) {
    throw new Error(`补丁 ${name}(${file}) 的锚点数量为 ${occurrences}（预期 1），上游产物可能变了，请人工复核`);
  }
  await writeFile(target, source.replace(search, replace), 'utf8');
}

const assetSearch = 'const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));';
const assetReplace = 'const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../../../dsh-pet/", import.meta.url)));';
applyPatch('asset-root', assetSearch, assetReplace);

const lazyLoaders = `/**
 * 延迟加载下载依赖（适配官方桌面端的 link:/file: 安装）。
 *
 * 顶层 \`import { downloadArtifact } from "@electron/get"\` 会让「依赖未安装」在插件
 * 激活阶段直接 ERR_MODULE_NOT_FOUND —— 连浏览器 overlay 一起挂掉。改成首次真正
 * 需要下载 Electron 时再加载：没有依赖时只有桌面形态降级，浏览器端照常工作。
 */
let electronDownloader$adapter;
async function loadElectronDownloader() {
	if (electronDownloader$adapter !== void 0) return electronDownloader$adapter;
	try {
		electronDownloader$adapter = (await import("@electron/get")).downloadArtifact;
		return electronDownloader$adapter;
	} catch (error) {
		throw new Error("dsh-pet: cannot load @electron/get（桌面形态下载 Electron 所需；请在插件目录运行 npm install，或设置 DSH_PET_ELECTRON_PATH 复用已有 Electron）: " + (error instanceof Error ? error.message : String(error)));
	}
}
let zipExtractor$adapter;
async function loadZipExtractor() {
	if (zipExtractor$adapter !== void 0) return zipExtractor$adapter;
	try {
		zipExtractor$adapter = (await import("@electron-internal/extract-zip")).default;
		return zipExtractor$adapter;
	} catch (error) {
		throw new Error("dsh-pet: cannot load @electron-internal/extract-zip（解压 Electron 所需；请在插件目录运行 npm install）: " + (error instanceof Error ? error.message : String(error)));
	}
}
`;
applyPatch('lazy-download-loaders', 'async function ensureElectronDownload(options = {}) {', `${lazyLoaders}async function ensureElectronDownload(options = {}) {`);

const trySearch = '\t\tmkdirSync(targetDir, { recursive: true });\n\t\tconst controller = new AbortController();';
const tryReplace = '\t\tconst downloadArtifact = await loadElectronDownloader();\n\t\tconst extract = await loadZipExtractor();\n\t\tmkdirSync(targetDir, { recursive: true });\n\t\tconst controller = new AbortController();';
applyPatch('lazy-download-call', trySearch, tryReplace);

applyPatch('drop-static-electron-import', 'import { downloadArtifact } from "@electron/get";\n', '');
applyPatch('drop-dynamic-zip-import', '\t\t\tconst { default: extract } = await import("@electron-internal/extract-zip");\n', '');

// ---------- 拖拽跟手（适配版手感优化） ----------
// 上游拖拽跟随弹簧 SPRING_K=200 / SPRING_C=30：稳态滞后 = v × C/K = 0.15 × 光标速度。
// 实测桌面小窗 480px/s 拖动滞后 ~40px（≈80ms）；快速甩动到 1200px/s 时滞后近 180px，
// 观感就是「窗口在拖住宠物」「拖到应用外面过一会儿才跟过来」。
// 改成 800/50 → 滞后 0.0625 × v（快 2.4 倍），阻尼比 0.88（原 1.06，仍无可见回弹）；
// 只动拖拽跟随这一条弹簧，抛掷速度/重力/反弹/落地摩擦/挤压曲线全部不变。
const springSearch = 'const SPRING_K = 200;\nconst SPRING_C = 30;';
const springReplace = 'const SPRING_K = 800;\nconst SPRING_C = 50;';
await applyFilePatch('drag-follow-stiffness-client', 'lib/client.js', springSearch, springReplace);
await applyFilePatch(
  'drag-follow-stiffness-desktop',
  'runtime/electron-helper/shared-core.js',
  springSearch,
  springReplace,
);

await writeFile(libPath, lib, 'utf8');

const resolvedAssetRoot = resolve(dirname(libPath), '../../../dsh-pet');
if (resolvedAssetRoot !== join(root, 'dsh-pet')) {
  throw new Error(`补丁后的素材根异常：${resolvedAssetRoot}`);
}
if (/^import \{ downloadArtifact \} from "@electron\/get";$/m.test(lib)) throw new Error('静态 @electron/get 导入未移除');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const files = {};
async function walk(directory, base = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, base);
    else files[relative(base, full).replaceAll('\\', '/')] = sha256(await readFile(full));
  }
}
await walk(staging);

const manifest = {
  upstream: { name: 'dsh-pet', version, tarball: tarballUrl, integrity: meta.dist.integrity ?? null },
  patches: [
    { name: 'asset-root', file: 'lib/index.js', reason: '素材根指向仓库 dsh-pet/assets，避免 54MB webm 重复入库', search: assetSearch, replace: assetReplace },
    { name: 'lazy-download-loaders', file: 'lib/index.js', reason: 'Electron 下载依赖改为按需加载', search: 'async function ensureElectronDownload(options = {}) {', replace: '（前置 loadElectronDownloader / loadZipExtractor）' },
    { name: 'drop-static-electron-import', file: 'lib/index.js', reason: '顶层 @electron/get import 会让 link: 安装缺依赖时整个插件激活失败', search: 'import { downloadArtifact } from "@electron/get";\n', replace: '' },
    { name: 'drop-dynamic-zip-import', file: 'lib/index.js', reason: '解压器改为 loadZipExtractor()，与下载器一起做缺依赖提示', search: '\t\t\tconst { default: extract } = await import("@electron-internal/extract-zip");\n', replace: '' },
    { name: 'drag-follow-stiffness-client', file: 'lib/client.js', reason: '拖拽跟随弹簧 200/30 → 800/50：滞后 0.15v → 0.0625v，浏览器 overlay 拖拽更跟手（不改抛掷物理）', search: 'const SPRING_K = 200;\nconst SPRING_C = 30;', replace: 'const SPRING_K = 800;\nconst SPRING_C = 50;' },
    { name: 'drag-follow-stiffness-desktop', file: 'runtime/electron-helper/shared-core.js', reason: '同上，桌面透明小窗拖拽跟随更跟手', search: 'const SPRING_K = 200;\nconst SPRING_C = 30;', replace: 'const SPRING_K = 800;\nconst SPRING_C = 50;' },
  ],
  removed: [],
  files,
};
await writeFile(join(staging, 'vendor-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const patches = `# 内置上游构建产物（只读）

本目录是 npm 上 \`dsh-pet@${version}\` 的**已构建产物**（\`lib/\` + \`runtime/\`），供「官方桌面端适配包」免构建直接安装。
由 \`scripts/sync-vendor.mjs\` 生成，请勿手改；升级上游时重跑该脚本。

## 与上游 tarball 的差异

1. \`lib/index.js\` 的 \`PACKAGE_ROOT\` 由「包根」改为「仓库内 \`dsh-pet/\`」——
   这样 \`assets/\`（含 54MB 的 \`webm\`）复用仓库里那份，不必在 \`vendor/\` 下重复一份；
   桌面运行时 \`runtime/electron-helper/\` 仍取本目录内与 \`lib\` 同版本的副本，避免宿主包
   与上游 main 分支的运行时产生协议漂移。
2. **Electron 下载依赖改为按需加载**：删除顶层 \`import { downloadArtifact } from "@electron/get"\`，
   改成首次真正需要下载时再 \`import()\`。官方桌面端的插件管理用 \`link:\` 装本地目录时不会安装
   被链接包的依赖；静态导入会让「缺 @electron/get」在激活阶段直接 ERR_MODULE_NOT_FOUND，
   连浏览器 overlay 一起挂掉。按需加载后只有桌面形态降级，并给出可操作提示。
3. **拖拽跟手调紧**：\`lib/client.js\` 与 \`runtime/electron-helper/shared-core.js\` 的拖拽跟随弹簧
   \`SPRING_K/SPRING_C\` 由 \`200/30\` 改为 \`800/50\`——稳态滞后从 \`0.15 × 光标速度\` 降到
   \`0.0625 × 光标速度\`（480px/s 拖动实测约 40px → 约 17px），阻尼比 0.88 无可见回弹。
   只影响拖拽跟随，抛掷/反弹/落地摩擦/挤压曲线不变。
4. 只保留运行所需文件：\`lib/index.js\`、\`lib/client.js\`、\`runtime/\`、\`package.json\`、\`LICENSE\`；
   类型声明与独立模式 CLI 不随适配包发布。

校验值见 \`vendor-manifest.json\`（逐文件 SHA-256）。
`;
await writeFile(join(staging, 'PATCHES.md'), patches, 'utf8');

await rm(packageRoot, { recursive: true, force: true });
await rename(staging, packageRoot);
console.log(`[sync-vendor] 完成：${Object.keys(files).length + 2} 个文件 → ${relative(root, packageRoot)}`);
