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

// ---------- 鼠标活动 → 待机链主动加动作（适配版优化） ----------
// 用户还在动鼠标（= 坐在电脑前忙）时，待机随机链最多每 18~28 秒**强制**抽一段「动作」分类播一次，
// 让宠物像在陪着干活；鼠标静下来超过 2.5s 就完全退回原有权重抽签。
// 只影响随机链：拖拽跟随、右键点播、事件动画（余额/碎碎念/工作状态）与物理一律不变。
// 桌面 helper 的窗口是点击穿透小窗、收不到窗外鼠标，所以主进程按**全局光标**轮询判定活动，
// 经 IPC 通知渲染端；浏览器 overlay 直接用 window pointermove。
const activityHelper = `// ---------- [适配] 鼠标活动 → 待机链主动加动作 ----------
// 用户在动鼠标（在电脑前忙）时，随机链每 18~28 秒强制抽一段「动作」分类；鼠标静下来就退回原权重。
// 只影响随机链，拖拽/点播/事件动画不变。桌面端由主进程经 IPC 喂 markMouseActivity。
const ACTIVITY_WINDOW_MS = 2500;
const ACTIVITY_COOLDOWN_MIN_MS = 18000;
const ACTIVITY_COOLDOWN_MAX_MS = 28000;
let lastMouseActivityAt = 0;
let nextActivityActionAt = 0;
const markMouseActivity = () => {
	lastMouseActivityAt = Date.now();
};
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
	window.addEventListener("pointermove", markMouseActivity, { passive: true });
}
const activityActionDue = () => {
	const now = Date.now();
	if (now - lastMouseActivityAt > ACTIVITY_WINDOW_MS) return false;
	if (now < nextActivityActionAt) return false;
	nextActivityActionAt = now + ACTIVITY_COOLDOWN_MIN_MS + Math.random() * (ACTIVITY_COOLDOWN_MAX_MS - ACTIVITY_COOLDOWN_MIN_MS);
	return true;
};
`;
const springStepSearch = 'const springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) =>';
await applyFilePatch(
  'activity-shared-helper',
  'runtime/electron-helper/shared-core.js',
  springStepSearch,
  activityHelper + springStepSearch,
);
await applyFilePatch(
  'activity-shared-export',
  'runtime/electron-helper/shared-core.js',
  'exports.springStep = springStep',
  'exports.activityActionDue = activityActionDue\nexports.markMouseActivity = markMouseActivity\nexports.springStep = springStep',
);
await applyFilePatch(
  'activity-sprite-chain',
  'runtime/electron-helper/sprite.js',
  '    const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });',
  "    // 鼠标在动（用户在用电脑）→ 强制抽一段「动作」分类（节流 18~28 秒，见 shared-core）\n    const k = S.activityActionDue() ? 'action' : S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });",
);
await applyFilePatch(
  'activity-main-ipc',
  'runtime/electron-helper/main.js',
  '      const point = screen.getCursorScreenPoint();',
  `      const point = screen.getCursorScreenPoint();
      // [适配] 鼠标活动上报：全局光标相对上次上报位移 >= 3px 且距上次 >= 250ms 才发一条，
      // 渲染端据此在待机链里「每 18~28 秒主动加一段动作」。穿透小窗收不到窗外 mousemove，
      // 所以只能由主进程按屏幕坐标判定。
      {
        const nowMs = Date.now();
        const last = win.__dshPetActivity || (win.__dshPetActivity = { at: 0, x: point.x, y: point.y });
        if (nowMs - last.at >= 250 && Math.abs(point.x - last.x) + Math.abs(point.y - last.y) >= 3) {
          last.at = nowMs;
          last.x = point.x;
          last.y = point.y;
          win.webContents.send('pet:mouse-activity');
        }
      }`,
);
await applyFilePatch(
  'activity-preload-ipc',
  'runtime/electron-helper/preload.js',
  '  onDisplays(cb) {',
  `  // [适配] 鼠标活动（主进程按全局光标判定、250ms 限流）→ 待机链主动加动作
  onMouseActivity(cb) {
    ipcRenderer.on('pet:mouse-activity', () => cb());
  },
  onDisplays(cb) {`,
);
await applyFilePatch(
  'activity-renderer-wire',
  'runtime/electron-helper/renderer.js',
  'injectAssets();',
  `injectAssets();
// [适配] 主进程的鼠标活动心跳 → 共享逻辑；待机链据此每 18~28 秒主动加一段动作
if (window.petBridge && typeof window.petBridge.onMouseActivity === 'function') {
  window.petBridge.onMouseActivity(() => S.markMouseActivity());
}`,
);
const clientRollSearch = 'const rollKind = (roll, w, opts) => {';
await applyFilePatch('activity-client-helper', 'lib/client.js', clientRollSearch, activityHelper + clientRollSearch);
await applyFilePatch(
  'activity-client-chain',
  'lib/client.js',
  '\t\t\tconst k = rollKind(roll, animationWeights, { fixed: cfg.fixedEnabled });',
  '\t\t\t// 鼠标在动（用户在用电脑）→ 强制抽一段「动作」分类（节流 18~28 秒）\n\t\t\tconst k = activityActionDue() ? "action" : rollKind(roll, animationWeights, { fixed: cfg.fixedEnabled });',
);

// ---------- 时段感知：晚上不许说「中午吃什么」 ----------
// 上游 0.3.7 已经把【当下】日期/时刻/时段写进 system，但“随便说一句日常碎碎念”这种泛指令会让模型
// 忽略它（实测深夜仍会蹦出「中午吃啥」）。这里做两件事：
//   1. system 里的背景行补一句硬约束：内容必须合乎当前时段；
//   2. 碎碎念的**用户指令**里直接带上「现在是亥时/深夜 23:26」，模型对紧邻指令的权重更高。
const timeHintHelper = `/** [适配] 生成指令里的「当前时段」提示：比 system 的背景描述更直接，模型更愿意遵守 */
function timeHintNow() {
	const now = new Date();
	const hour = now.getHours();
	return "（现在是" + timeSlotOf(hour) + " " + pad2(hour) + ":" + pad2(now.getMinutes()) + "，这句话要符合这个时段：深夜/晚上别问中午吃什么，早上别聊晚饭。）";
}
`;
// 注意：lib/index.js 走内存里的 `lib` 变量（applyPatch），末尾统一落盘——
// 用 applyFilePatch 会被后面的 writeFile 覆盖掉。
applyPatch('time-hint-helper', 'function timeSlotOf(hour) {', timeHintHelper + 'function timeSlotOf(hour) {');
applyPatch(
  'time-context-rule',
  '。这只是背景，不必刻意报时，也别句句都提节日——多数时候正常说话就好，真贴切时才顺口带一句。',
  '。这只是背景，不必刻意报时，也别句句都提节日；但**内容必须合乎当前时段**——现在是" + timeSlotOf(hour) + "，不要提其它时段才发生的事（例如深夜别问「中午吃什么」、早上别聊晚饭）。多数时候正常说话就好，真贴切时才顺口带一句。',
);
applyPatch(
  'whisper-time-hint',
  'text: meme ? userTextWithMeme(meme) : USER_TEXT',
  'text: (meme ? userTextWithMeme(meme) : USER_TEXT) + timeHintNow()',
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
    { name: 'activity-shared-helper', file: 'runtime/electron-helper/shared-core.js', reason: '鼠标活动判定（2.5s 窗口 + 18~28s 冷却），供待机链主动加动作', search: 'const springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) =>', replace: '（前置 ACTIVITY_* 常量 / markMouseActivity / activityActionDue）' },
    { name: 'activity-shared-export', file: 'runtime/electron-helper/shared-core.js', reason: '导出 activityActionDue / markMouseActivity 给 sprite 与 renderer', search: 'exports.springStep = springStep', replace: '（新增两行导出）' },
    { name: 'activity-sprite-chain', file: 'runtime/electron-helper/sprite.js', reason: '桌面待机链：鼠标在动时强制走「动作」分类', search: 'const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });', replace: "const k = S.activityActionDue() ? 'action' : S.rollKind(…)" },
    { name: 'activity-main-ipc', file: 'runtime/electron-helper/main.js', reason: '主进程按全局光标判定鼠标活动，250ms 限流后 IPC 通知窗口', search: 'const point = screen.getCursorScreenPoint();', replace: '（追加活动心跳上报块）' },
    { name: 'activity-preload-ipc', file: 'runtime/electron-helper/preload.js', reason: '暴露 onMouseActivity(cb) 给渲染端', search: 'onDisplays(cb) {', replace: '（前置 onMouseActivity）' },
    { name: 'activity-renderer-wire', file: 'runtime/electron-helper/renderer.js', reason: '把主进程活动心跳接到共享逻辑 markMouseActivity', search: 'injectAssets();', replace: '（追加 onMouseActivity 订阅）' },
    { name: 'activity-client-helper', file: 'lib/client.js', reason: '浏览器 overlay 同款鼠标活动判定（window pointermove）', search: 'const rollKind = (roll, w, opts) => {', replace: '（前置 ACTIVITY_* / activityActionDue）' },
    { name: 'activity-client-chain', file: 'lib/client.js', reason: '浏览器待机链：鼠标在动时强制走「动作」分类', search: 'const k = rollKind(roll, animationWeights, { fixed: cfg.fixedEnabled });', replace: 'const k = activityActionDue() ? "action" : rollKind(…)' },
    { name: 'time-hint-helper', file: 'lib/index.js', reason: '碎碎念指令带上「现在是几点/哪个时段」，模型对紧邻指令权重更高', search: 'function timeSlotOf(hour) {', replace: '（前置 timeHintNow()）' },
    { name: 'time-context-rule', file: 'lib/index.js', reason: 'system 的时间背景补硬约束：内容必须合乎当前时段（深夜别问中午吃什么）', search: '。这只是背景，不必刻意报时，也别句句都提节日——多数时候正常说话就好，真贴切时才顺口带一句。', replace: '（追加时段约束句）' },
    { name: 'whisper-time-hint', file: 'lib/index.js', reason: '碎碎念用户指令末尾追加当前时段提示', search: 'text: meme ? userTextWithMeme(meme) : USER_TEXT', replace: 'text: (meme ? userTextWithMeme(meme) : USER_TEXT) + timeHintNow()' },
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
4. **鼠标活动 → 待机链主动加动作**：鼠标在动（2.5s 内有过移动）时，待机随机链每 18~28 秒
   **强制**抽一段「动作」分类播放（像在陪着干活）；鼠标静下来就退回原有权重抽签。
   桌面 helper 的穿透小窗收不到窗外鼠标移动，故由主进程按全局光标判定（250ms 限流）经 IPC
   通知渲染端；浏览器 overlay 直接监听 \`window pointermove\`。只影响随机链，拖拽/点播/事件动画不变。
5. **时段感知（碎碎念/对话）**：上游已把【当下】日期/时刻/时段写进 system，但泛指令下模型常忽略
   （实测深夜仍会说「中午吃啥」）。适配版两处加固：system 的背景行补一句硬约束「内容必须合乎当前
   时段」，碎碎念的**用户指令**末尾直接带「现在是深夜 23:26，这句话要符合这个时段」。
6. 只保留运行所需文件：\`lib/index.js\`、\`lib/client.js\`、\`runtime/\`、\`package.json\`、\`LICENSE\`；
   类型声明与独立模式 CLI 不随适配包发布。

校验值见 \`vendor-manifest.json\`（逐文件 SHA-256）。
`;
await writeFile(join(staging, 'PATCHES.md'), patches, 'utf8');

await rm(packageRoot, { recursive: true, force: true });
await rename(staging, packageRoot);
console.log(`[sync-vendor] 完成：${Object.keys(files).length + 2} 个文件 → ${relative(root, packageRoot)}`);
