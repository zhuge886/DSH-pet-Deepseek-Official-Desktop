/**
 * dsh-pet 官方桌面端适配层（host 半侧入口）
 *
 * 这个文件是仓库根 package.json 的 main，也是 bundle patch 里 entry 指向的模块。
 * 它做两件事：
 *   1. 加载上游 0.3.7 的已构建宿主半边（vendor/…/lib/index.js，免构建）；
 *   2. 在调用上游 apply 前后套一层「官方桌面端适配」：健康检查、宿主/运行时诊断、
 *      以及**上游初始化失败时不阻断整个 profile 启动**（上游 issue #80 的教训）。
 *
 * 刻意不做的事：
 *   - 不重写上游的桌宠逻辑、不改配置格式、不碰 HTTP 路由语义；
 *   - 不在进程内改 `process.env`（会影响 DSH 自己的子进程），只做只读诊断；
 *   - 不冒充官方桌面端窗口 API（0.2.1-rc.1 的插件宿主是 Node 模式，没有建窗能力）。
 *
 * @module dsh-pet
 */
import { apply as applyUpstream, inject, name } from '../vendor/dsh-pet-0.3.7/lib/index.js';
import { createDesktopAdapter } from './desktop.js';

export { inject, name };

/**
 * Cordis 插件入口。
 * @param ctx - DSH 插件上下文。
 * @param config - bundle patch 里传下来的配置（只读 `desktopAdapter` 段）。
 */
export function apply(ctx, config = {}) {
  const options = config?.desktopAdapter ?? {};
  const adapter = createDesktopAdapter(ctx, options);
  adapter.installHealthRoute();

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => () => adapter.dispose());
  }

  try {
    applyUpstream(ctx, config);
    adapter.markApplied();
  } catch (error) {
    adapter.markFailed(error);
    adapter.logSummary();
    if (options.resilient === false) throw error;
    return;
  }
  adapter.logSummary();
}
