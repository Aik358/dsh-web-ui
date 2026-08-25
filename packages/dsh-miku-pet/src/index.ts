/**
 * miku-pet 宿主半侧（host half）—— 宠物插件的"后端"部分
 *
 * 职责：在 DSH Web 服务器上注册 `/miku-pet/` 前缀路由，把宠物帧素材 / 配置 JSONC
 * 流式返回给浏览器。源文件（src/index.ts）由 tsdown 构建为 lib/index.js。
 *
 * 路由：
 *   /miku-pet/thumb/<动作>/<帧>.png|.webp → $DSH_HOME/miku-pet/main-animation/（用户目录，优先）→ 插件包内 assets/thumb/
 *   /miku-pet/frames/<动作>         → thumb/<动作>/ 帧清单（名称+时长）
 *   /miku-pet/config.jsonc          → 插件包内 assets/config.jsonc（默认值，只读）
 *   /miku-pet/config                → 用户覆盖配置（pets / animations / animationWeights，JSON）
 *                                       GET 读取、PUT 保存、DELETE 恢复默认（删除用户层）
 *   /miku-pet/config/meta           → 配置文件与素材目录路径（设置页展示用）
 *
 * 注意：路由前缀与 entry id 用 `miku-pet` 而非 `pet`，避免与本机已装的
 * dsh-web-ui 内置 dsh-pet（`/pet/*` + `/api/pet/*`）冲突。
 *
 * 安全性：resolveAsset 做"防穿越"校验，保证路径仍在对应根目录内。
 *
 * TODO(类型)：peer 依赖类型包本地暂不可解析，ctx/req/res 暂用 any；
 *             依赖可解析后替换为 DSH 官方类型。
 */
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { isLoopbackRequest } from './loopback.ts';
import { mountOnce } from './mount-once.ts';

/** 插件行 id（与 cordis.patch.yml 一致；避开内置 dsh-pet 的 web-ui-pet） */
export const name = 'miku-pet';
/** 需要注入的服务：webServer（Web 服务器路由注册表） */
export const inject = ['webServer'];

/** 本包目录：宿主构建产物位于 lib/，其上一级即包根。 */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 路由前缀（改名避冲突，见文件头注释） */
const ROUTE_PREFIX = '/miku-pet';

/** 不同扩展名对应的 Content-Type 映射 */
const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.jsonc': 'application/json; charset=utf-8',
};

/**
 * 规范化并校验请求路径，确保它在 assets 根目录内（防路径穿越）。
 * @returns 规范化后的绝对文件路径；非法（穿越）时返回 undefined
 */
export function resolveAsset(root: string, rel: string): string | undefined {
  if (rel.length === 0) return undefined;
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

/** 在 root 下解析并确认实体存在；非法（穿越）或不存在时返回 undefined */
function resolveExisting(root: string, rel: string): string | undefined {
  const candidate = resolveAsset(root, rel);
  return candidate && existsSync(candidate) ? candidate : undefined;
}

/** 流式返回一个文件（带 Content-Type / 长度 / 缓存头）；cacheControl 缺省允许浏览器缓存 1h（静态素材）。
 * 配置类文件（config.jsonc）必须传 'no-cache'，防浏览器吃到过期配置。 */
async function sendFile(
  res: ServerResponse,
  file: string,
  contentType: string,
  cacheControl = 'public, max-age=3600',
): Promise<void> {
  const { size } = await stat(file);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': size,
    'cache-control': cacheControl,
  });
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** 支持的角落白名单（与 client 端一致） */
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** 发送 JSON 响应（no-cache：配置/帧清单会演进，禁止浏览器缓存） */
function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-cache',
  });
  res.end(body);
}

/** 收集请求体（文本）；带大小上限防滥用 */
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve2, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve2(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 校验并归一化动作名：单段、不含 `..` / 分隔符 / 控制字符，防 frames 路径上溯。
 * @returns 安全动作名；非法返回 null */
export function sanitizeAction(input: string): string | null {
  if (!input) return null;
  // eslint-disable-next-line no-control-regex
  if (input.includes('..') || /[\\/\x00-\x1f]/.test(input)) return null;
  return input;
}

/** 校验并归一化用户配置覆盖。保留 pets（id/size/position/name）及可选动画覆盖
 * （animations / animationWeights，与客户端 UserOverrides 同构），避免保存时清空高级自定义。
 * 任一字段非法 → 整体拒绝（返回 null）。 */
export function sanitizeUserConfig(raw: unknown): { pets: unknown[]; animations?: unknown; animationWeights?: unknown } | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const arr = Array.isArray(o.pets) ? o.pets : null;
  if (!arr || !arr.length) return null;
  const out: unknown[] = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') return null;
    const pp = p as Record<string, unknown>;
    const id = String(pp.id ?? '');
    // 有意过滤文件名非法字符（Windows 保留符 + 控制字符），防止配置值逃逸 main-config.json 路径
    // eslint-disable-next-line no-control-regex
    if (!id || id.length > 64 || /[\\/:\x00-\x1f]/.test(id)) return null;
    const size = Number(pp.size);
    if (!Number.isFinite(size) || size <= 0) return null;
    const pos = pp.position && typeof pp.position === 'object' ? (pp.position as Record<string, unknown>) : {};
    const corner = String(pos.corner ?? '');
    if (!CORNERS.includes(corner)) return null;
    const marginX = Number(pos.marginX);
    const marginY = Number(pos.marginY);
    if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) return null;
    // name 可选：非 string / 超长 / 含控制字符则丢弃（与客户端 assertClientConfig 一致）
    const rawName = typeof pp.name === 'string' ? pp.name.trim() : '';
    // eslint-disable-next-line no-control-regex
    const name = rawName && rawName.length <= 32 && !/[\x00-\x1f]/.test(rawName) ? rawName : undefined;
    out.push({ id, size, position: { corner, marginX, marginY }, ...(name !== undefined ? { name } : {}) });
  }
  const clean: { pets: unknown[]; animations?: unknown; animationWeights?: unknown } = { pets: out };
  // 动画池/权重覆盖：仅透传宽松结构（pets 外的覆盖字段不参与路径，风险低）；非法结构丢弃
  if (o.animations && typeof o.animations === 'object') clean.animations = o.animations;
  if (o.animationWeights && typeof o.animationWeights === 'object') clean.animationWeights = o.animationWeights;
  return clean;
}

/** 宿主插件主体：注册 `/miku-pet` 前缀路由。
 * apply 经 mountOnce 包装：独立安装 + 聚合安装（web-ui-miku-pet 行）双源共存时,
 * 第二个实例 apply 为空操作,避免 `webserver: duplicate prefix route` 启动失败。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 注入的 ctx（webServer/locale 等 service 无静态类型）
export function applyImpl(ctx: any): void {
  const thumbRoot = join(PACKAGE_ROOT, 'assets', 'thumb');
  // 用户数据根：配置与用户素材统一收敛于此（扩展包按 <插件id> 各自建目录）
  const userRoot = join(resolveDshHome(), 'miku-pet');
  // 用户覆盖配置（pets / animations / animationWeights 覆盖片段）
  const userConfigPath = join(userRoot, 'main-config.json');
  // 用户动画目录（thumb 播放时优先于包内 assets/thumb）
  const thumbUserRoot = join(userRoot, 'main-animation');

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          let rest: string;
          try {
            rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
          } catch {
            sendJson(res, 400, { error: 'bad percent-encoding' });
            return;
          }

          // 帧清单:/miku-pet/frames/<动作> → thumb/<动作>/ 下的 png/webp 帧序列(用户目录优先)
          // 帧时长按 `名字_帧号_毫秒.png|webp` 解析,缺失时默认 200ms;帧序按文件名末尾数字。
          if (rest.startsWith('frames/')) {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'method not allowed' });
              return;
            }
            const action = sanitizeAction(rest.slice('frames/'.length).split('/')[0]);
            if (!action) {
              sendJson(res, 400, { error: 'invalid action' });
              return;
            }
            // 用 resolveAsset 校验动作目录在各自根内（防 `..` 上溯列目录）
            const userDir = resolveAsset(thumbUserRoot, action);
            const pkgDir = resolveAsset(thumbRoot, action);
            const roots = [userDir, pkgDir].filter((p): p is string => !!p && existsSync(p));
            if (!roots.length) {
              sendJson(res, 404, { error: 'no such action' });
              return;
            }
            const dir = roots[0];
            const names = readdirSync(dir)
              .filter((f) => /\.(png|webp)$/i.test(f))
              .sort((a, b) => {
                const ak = Number(a.match(/(\d+)(?!.*\d)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
                const bk = Number(b.match(/(\d+)(?!.*\d)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
                return ak - bk;
              });
            const frames = names.map((name) => {
              const m = name.match(/_(\d+)_(\d+)\.(png|webp)$/i);
              return { name, ms: m ? parseInt(m[2], 10) || 200 : 200 };
            });
            sendJson(res, 200, { frames });
            return;
          }

          // 用户覆盖配置：/miku-pet/config（GET / PUT / DELETE）
          if (rest === 'config') {
            if (req.method === 'GET') {
              try {
                const raw = await readFile(userConfigPath, 'utf8');
                sendJson(res, 200, JSON.parse(raw));
              } catch {
                sendJson(res, 200, {}); // 无覆盖配置 → 空对象，client 回落默认
              }
              return;
            }
            if (req.method === 'PUT') {
              if (!isLoopbackRequest(req)) {
                sendJson(res, 403, { error: 'forbidden: loopback-only' });
                return;
              }
              try {
                const body = await readBody(req);
                const parsed = JSON.parse(body);
                const clean = sanitizeUserConfig(parsed);
                if (!clean) {
                  sendJson(res, 400, {
                    error: 'invalid pet config: expected { pets:[{id,size,position:{corner,marginX,marginY}}] }',
                  });
                  return;
                }
                await mkdir(userRoot, { recursive: true });
                await writeFile(userConfigPath, JSON.stringify(clean, null, 2), 'utf8');
                sendJson(res, 200, { ok: true });
              } catch {
                sendJson(res, 400, { error: 'invalid JSON body' });
              }
              return;
            }
            if (req.method === 'DELETE') {
              if (!isLoopbackRequest(req)) {
                sendJson(res, 403, { error: 'forbidden: loopback-only' });
                return;
              }
              try {
                await rm(userConfigPath, { force: true });
              } catch {
                /* 不存在也视为成功 */
              }
              sendJson(res, 200, { ok: true });
              return;
            }
            sendJson(res, 405, { error: 'method not allowed' });
            return;
          }

          // 配置文件路径（设置页「高级配置」展示用）
          if (rest === 'config/meta') {
            sendJson(res, 200, {
              user: userConfigPath,
              default: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
              animations: thumbUserRoot,
            });
            return;
          }

          // 配置文件（JSONC）：/miku-pet/config.jsonc → 包内 assets/config.jsonc（no-cache，防陈旧配置）
          if (rest === 'config.jsonc') {
            const cfgFile = join(PACKAGE_ROOT, 'assets', 'config.jsonc');
            if (!existsSync(cfgFile)) {
              res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
              res.end('miku-pet: config.jsonc not found');
              return;
            }
            await sendFile(res, cfgFile, MIME['.jsonc'] ?? 'application/octet-stream', 'no-cache');
            return;
          }

          // 动画文件：/miku-pet/thumb/<file>，查找顺序 = 用户动画目录 → 包内 assets/thumb
          if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
          }
          const [scope, ...nameParts] = rest.split('/');
          if (scope !== 'thumb') {
            res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('miku-pet: expected /miku-pet/thumb/<file>');
            return;
          }
          const fileName = nameParts.join('/');
          const file = resolveExisting(thumbUserRoot, fileName) ?? resolveExisting(thumbRoot, fileName);
          if (file === undefined) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('miku-pet: asset not found');
            return;
          }
          const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
          await sendFile(res, file, MIME[ext] ?? 'application/octet-stream');
        },
      }),
    'miku-pet: /miku-pet asset route',
  );
}

/** 双源安装（独立 + 聚合 web-ui-miku-pet）防重守护：第二个 apply 为空操作。 */
export const apply = mountOnce('@linxin666/dsh-miku-pet', applyImpl);
