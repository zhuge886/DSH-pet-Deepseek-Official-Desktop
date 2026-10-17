/**
 * 官方桌面端适配层（纯逻辑，可单测）
 *
 * 背景：官方桌面应用（Electron）以 `ELECTRON_RUN_AS_NODE=1` 拉起插件宿主，
 * 桌宠的「桌面形态」却需要再启动一个真正的 GUI Electron。上游 0.3.7 已经会在
 * spawn 前删掉 ELECTRON_RUN_AS_NODE，但桌面宿主的环境、Electron 的获取方式、
 * 以及「插件初始化失败会不会拖垮整个 DSH」仍需要一层明确的适配与诊断。
 *
 * 本模块只做三件事，不碰上游内部实现：
 *   1. 识别宿主形态（官方桌面 / dsh web / 独立 Node），记录 Electron 版本与 DSH home；
 *   2. 复刻上游的 Electron 探测顺序（DSH_PET_ELECTRON_PATH → $DSH_HOME/electron → npm electron），
 *      在真正触发 100MB 下载之前把结果暴露出来；
 *   3. 生成只读健康检查快照，并指出会劫持 Electron 启动的环境变量。
 *
 * @module dsh-pet/desktop-adapter
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 适配层标识（健康检查与日志用） */
export const ADAPTER_ID = 'dsh-pet-desktop';
/** 上游已构建产物的版本（vendor/dsh-pet-<version>） */
export const UPSTREAM_VERSION = '0.3.7';
/** 只读健康检查路由（挂在 DSH 自己的 Web 服务上，与桌宠路由前缀不重叠） */
export const HEALTH_PATH = '/dsh-pet-desktop/health';

/** 桌面形态首次下载 Electron 所需的运行时依赖（上游按需 import） */
export const DOWNLOAD_DEPENDENCIES = ['@electron/get', '@electron-internal/extract-zip'];

/** 各平台 Electron 可执行文件在落地目录下的相对路径（与上游 helper-process 一致） */
const ELECTRON_RELATIVE = {
  win32: 'electron.exe',
  darwin: join('Electron.app', 'Contents', 'MacOS', 'Electron'),
};

/**
 * 平台对应的 Electron 可执行文件相对路径。
 * @param platform - process.platform 取值。
 * @returns 相对路径；未知平台按 Unix 单文件处理。
 */
export function electronRelativePath(platform) {
  return ELECTRON_RELATIVE[platform] ?? 'electron';
}

/**
 * 解析 DSH home，规则与上游 helper-process.ts 的 dshHomeDir() 保持一致：
 * `DSH_HOME` 原样优先，否则 `<USERPROFILE|HOME>/.dsh`。
 * @param env - 环境变量映射。
 * @returns 绝对或相对（当 DSH_HOME 本身是相对路径时）路径。
 */
export function resolveDshHome(env = process.env) {
  if (env.DSH_HOME) return env.DSH_HOME;
  return join(env.USERPROFILE || env.HOME || homedir(), '.dsh');
}

/**
 * 识别当前宿主形态。
 *
 * 判据与上游一致：`process.versions.electron` 存在即桌面应用宿主——官方桌面
 * 用 `ELECTRON_RUN_AS_NODE=1` 跑宿主时该字段仍在；`dsh web` 是纯 Node。
 * @param options - 可注入的 versions/env/platform，便于测试。
 * @returns 宿主快照（不含任何凭据）。
 */
export function detectHost({ versions = process.versions, env = process.env, platform = process.platform } = {}) {
  const electronVersion = versions?.electron ?? null;
  return {
    kind: electronVersion === null ? 'web' : 'desktop',
    electronVersion,
    nodeVersion: versions?.node ?? null,
    // 官方桌面壳会额外注入 DSH_CLIENT_VERSION（resources/app.asar 的 main.js 传给 Host 进程）；
    // DSH_DESKTOP_* 只在开发/解包运行时出现，作为兜底信号。
    officialDesktopShell: Boolean(env.DSH_CLIENT_VERSION || env.DSH_DESKTOP_NODE_EXECUTABLE || env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR),
    clientVersion: env.DSH_CLIENT_VERSION || null,
    dshHome: resolveDshHome(env),
    profile: env.DSH_PROFILE || null,
    platform,
  };
}

const require = createRequire(import.meta.url);

/**
 * 默认的 npm electron 探测：`require('electron')` 返回二进制路径字符串。
 * 未安装时抛错，由调用方忽略。
 * @returns 可执行文件路径或 undefined。
 */
function requireNpmElectron() {
  const value = require('electron');
  return typeof value === 'string' ? value : undefined;
}

/**
 * 按上游顺序列出 Electron 候选（不下载、不 spawn）。
 * @param options - 可注入 env/platform/exists/requireElectron。
 * @returns 候选数组，每项含 path/source/exists。
 */
export function electronCandidates({ env = process.env, platform = process.platform, exists = existsSync, requireElectron = requireNpmElectron } = {}) {
  const candidates = [];
  const add = (path, source) => {
    if (typeof path !== 'string' || path.length === 0) return;
    if (candidates.some((item) => item.path === path)) return;
    candidates.push({ path, source, exists: Boolean(exists(path)) });
  };
  add(env.DSH_PET_ELECTRON_PATH, 'DSH_PET_ELECTRON_PATH');
  add(join(resolveDshHome(env), 'electron', electronRelativePath(platform)), 'dsh-home');
  try {
    add(requireElectron?.(), 'npm-electron');
  } catch {
    /* electron 未安装：正常分支 */
  }
  return candidates;
}

/**
 * 列出会劫持 GUI Electron 启动的继承环境变量。
 *
 * - `ELECTRON_RUN_AS_NODE`：官方桌面宿主自身就带（设计如此），上游 spawn 前会删键；
 *   这里只做可见化，方便崩溃时对照 issue #63 / #98。
 * - `NODE_OPTIONS` 携带 --require/--import/--loader：会注入 Electron 主进程，
 *   上游目前不会清，属于潜在风险，健康检查里提示。
 * @param env - 环境变量映射。
 * @returns 风险项数组（只含名称与原因，不回显敏感值）。
 */
export function helperEnvHazards(env = process.env) {
  const hazards = [];
  if (env.ELECTRON_RUN_AS_NODE !== undefined) {
    hazards.push({
      name: 'ELECTRON_RUN_AS_NODE',
      reason: 'Electron 会以纯 Node 模式启动，主进程 require("electron") 不可用；上游 spawn 前会删键',
    });
  }
  const nodeOptions = env.NODE_OPTIONS ?? '';
  if (/(^|\s)--(require|import|loader)(\s|=|$)/.test(nodeOptions)) {
    hazards.push({
      name: 'NODE_OPTIONS',
      reason: 'Node 预加载钩子会被 Electron 主进程继承，可能导致启动即崩',
    });
  }
  return hazards;
}

/**
 * 生成「干净」的 helper 环境：删掉 ELECTRON_RUN_AS_NODE，并在 NODE_OPTIONS 含
 * 预加载钩子时删掉它。上游 0.3.7 只做了第一项；本函数用于健康检查展示与测试，
 * 不改写进程环境。
 * @param env - 环境变量映射。
 * @returns 新对象，原映射不被修改。
 */
export function sanitizedHelperEnv(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  if (helperEnvHazards(env).some((hazard) => hazard.name === 'NODE_OPTIONS')) delete next.NODE_OPTIONS;
  return next;
}

/**
 * 探测 Electron 下载依赖是否可解析。
 *
 * 官方桌面端用 `link:` / `file:` 装本地目录时**不会安装被链接包的依赖**，
 * 上游 0.3.7 曾在顶层静态 import @electron/get，导致「缺依赖」在插件激活阶段
 * 直接 ERR_MODULE_NOT_FOUND。适配包已把两个依赖改成按需加载，这里只做可观测性：
 * 缺依赖时桌面形态会降级，浏览器 overlay 不受影响。
 * @param options - 可注入的 resolve（默认 import.meta.resolve），便于测试。
 * @returns ready / missing / dependencies。
 */
export function probeDownloadDependencies({ resolve = (name) => import.meta.resolve(name) } = {}) {
  const missing = [];
  for (const name of DOWNLOAD_DEPENDENCIES) {
    try {
      resolve(name);
    } catch {
      missing.push(name);
    }
  }
  return { ready: missing.length === 0, missing, dependencies: [...DOWNLOAD_DEPENDENCIES] };
}

/**
 * 计算桌面运行时方案（不产生副作用）。
 * @param options - 可注入 env/platform/exists/requireElectron。
 * @returns 候选、最终命中、是否需要下载，以及环境风险。
 */
export function desktopRuntimePlan(options = {}) {
  const { env = process.env, platform = process.platform, exists = existsSync, requireElectron } = options;
  const candidates = electronCandidates({ env, platform, exists, requireElectron });
  const usable = candidates.find((item) => item.exists) ?? null;
  return {
    candidates,
    electronPath: usable?.path ?? null,
    source: usable?.source ?? null,
    requiresDownload: usable === null,
    downloadRoot: join(resolveDshHome(env), 'electron'),
    downloadDependencies: probeDownloadDependencies(options.downloadDependencies ?? {}),
    hazards: helperEnvHazards(env),
  };
}

/**
 * 把状态序列化成健康检查响应。
 * @param state - createDesktopAdapter 的内部状态。
 * @returns 可 JSON 序列化的对象。
 */
export function describeHealth(state) {
  return {
    ok: state.status !== 'failed',
    adapter: { id: ADAPTER_ID, upstream: UPSTREAM_VERSION },
    status: state.status,
    startedAt: state.startedAt,
    host: state.host,
    runtime: state.runtime,
    upstream: state.upstream,
    health: { route: state.health.route, registered: state.health.registered, error: state.health.error },
  };
}

/**
 * 创建一次插件加载对应的适配器：注册健康检查、记录上游初始化结果、输出一行诊断日志。
 * @param ctx - Cordis 上下文（只需要 logger/webServer/effect）。
 * @param options - 适配选项：resilient（默认 true）、healthRoute（默认 true）、host/runtime 注入（测试用）。
 * @returns 适配器句柄。
 */
export function createDesktopAdapter(ctx, options = {}) {
  const state = {
    status: 'starting',
    startedAt: new Date().toISOString(),
    host: detectHost(options.host ?? {}),
    runtime: desktopRuntimePlan(options.runtime ?? {}),
    upstream: { applied: false, error: null },
    health: { route: HEALTH_PATH, registered: false, error: null, disposers: [] },
  };

  const log = (level, message) => {
    const logger = ctx?.logger;
    const method = logger?.[level];
    if (typeof method === 'function') {
      method.call(logger, message);
      return;
    }
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(message);
  };

  const installHealthRoute = () => {
    if (options.healthRoute === false) return;
    const server = ctx?.webServer;
    if (!server || typeof server.register !== 'function') {
      state.health.error = 'webServer 服务不可用，健康检查未注册';
      return;
    }
    try {
      const dispose = server.register({
        kind: 'exact',
        path: HEALTH_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
            res.end('method not allowed\n');
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify(describeHealth(state), null, 2));
        },
      });
      state.health.disposers.push(dispose);
      state.health.registered = true;
    } catch (error) {
      state.health.error = error instanceof Error ? error.message : String(error);
      log('warn', `[dsh-pet-desktop] 健康检查路由注册失败：${state.health.error}`);
    }
  };

  const logSummary = () => {
    const { host, runtime } = state;
    log('info', `[dsh-pet-desktop] 适配层已加载：host=${host.kind}，electron=${host.electronVersion ?? 'none'}，官方桌面壳=${host.officialDesktopShell}，client=${host.clientVersion ?? 'unknown'}`);
    if (runtime.electronPath) {
      log('info', `[dsh-pet-desktop] 桌面运行时：${runtime.electronPath}（来源 ${runtime.source}）`);
    } else {
      log('info', `[dsh-pet-desktop] 桌面运行时未就绪：首次启用桌面形态将下载 Electron 到 ${runtime.downloadRoot}；可用 DSH_PET_ELECTRON_PATH 复用已有运行时`);
      if (!runtime.downloadDependencies.ready) {
        log('warn', `[dsh-pet-desktop] 缺少 Electron 下载依赖 ${runtime.downloadDependencies.missing.join('、')}：桌面形态会降级（浏览器 overlay 不受影响）。在插件目录运行 npm install，或设置 DSH_PET_ELECTRON_PATH 复用已有 Electron。`);
      }
    }
    for (const hazard of runtime.hazards) {
      log('warn', `[dsh-pet-desktop] 继承环境 ${hazard.name}：${hazard.reason}`);
    }
    if (state.upstream.error) {
      log('error', `[dsh-pet-desktop] 上游初始化失败（已降级，不阻断 DSH 启动）：${state.upstream.error}`);
    }
  };

  return {
    state,
    installHealthRoute,
    logSummary,
    markApplied() {
      state.status = 'active';
      state.upstream.applied = true;
      state.upstream.error = null;
    },
    markFailed(error) {
      state.status = 'failed';
      state.upstream.applied = false;
      state.upstream.error = error instanceof Error ? error.message : String(error);
    },
    dispose() {
      for (const disposer of state.health.disposers.splice(0)) {
        try {
          disposer();
        } catch {
          /* 宿主已卸载：忽略 */
        }
      }
      state.health.registered = false;
    },
  };
}
