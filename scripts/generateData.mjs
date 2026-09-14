// 从 npm registry 元数据（/tmp/meta/*.json）生成"真实生态示例"锁文件。
// 版本号、许可证、依赖范围均取自 registry 真实发布记录；仅锁文件布局（嵌套 node_modules）
// 与两处 auditInject 审计注入边是为教学演示构造的，见末尾说明。
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const metaDir = '/tmp/meta';

const m = (file) => JSON.parse(readFileSync(join(metaDir, file), 'utf8'));
const M = {
  finalhandler: m('finalhandler_1.1.2.json'),
  unpipe: m('unpipe_1.0.0.json'),
  parseurl: m('parseurl_1.3.3.json'),
  statuses14: m('statuses_1.4.0.json'),
  statuses15: m('statuses_1.5.0.json'),
  encodeurl: m('encodeurl_1.0.2.json'),
  escapeHtml: m('escape-html_1.0.3.json'),
  onFinished: m('on-finished_2.3.0.json'),
  eeFirst: m('ee-first_1.1.1.json'),
  debug269: m('debug_2.6.9.json'),
  debug434: m('debug_4.3.4.json'),
  ms200: m('ms_2.0.0.json'),
  ms213: m('ms_2.1.3.json'),
  ms073: m('ms_0.7.3.json'),
  socketParser: m('socket.io-parser_4.2.4.json'),
  componentEmitter: m('_socket.io_component-emitter_3.1.0.json'),
  agentBase: m('agent-base_6.0.2.json'),
  es6WeakMap: m('es6-weak-map_2.0.3.json'),
  es6Iterator: m('es6-iterator_2.0.3.json'),
  es6Symbol: m('es6-symbol_3.1.3.json'),
  es5Ext: m('es5-ext_0.10.62.json'),
  d: m('d_1.0.1.json'),
  type12: m('type_1.2.0.json'),
  type273: m('type_2.7.3.json'),
  ext: m('ext_1.7.0.json'),
  nextTick: m('next-tick_1.1.0.json'),
  esniff: m('esniff_1.1.0.json'),
  eventEmitter: m('event-emitter_0.3.5.json'),
  glob: m('glob_7.2.3.json'),
  rimraf: m('rimraf_3.0.2.json'),
  once: m('once_1.4.0.json'),
  inflight: m('inflight_1.0.6.json'),
  inherits: m('inherits_2.0.4.json'),
  minimatch: m('minimatch_3.1.2.json'),
  braceExpansion: m('brace-expansion_1.1.11.json'),
  concatMap: m('concat-map_0.0.1.json'),
  balancedMatch: m('balanced-match_1.0.2.json'),
  fsRealpath: m('fs.realpath_1.0.0.json'),
  pathIsAbsolute: m('path-is-absolute_1.0.1.json'),
  wrappy: m('wrappy_1.0.2.json'),
  tmp: m('tmp_0.0.33.json'),
  osTmpdir: m('os-tmpdir_1.0.2.json'),
  jsonStream: m('JSONStream_1.3.5.json'),
  through: m('through_2.3.8.json'),
  jsonparse: m('jsonparse_1.3.1.json'),
  jszip: m('jszip_3.10.1.json'),
  lie: m('lie_3.3.0.json'),
  pako: m('pako_1.0.11.json'),
  setImmediate: m('setimmediate_1.0.5.json'),
  immediate: m('immediate_3.0.6.json'),
  rc: m('rc_1.2.8.json'),
  ini: m('ini_1.3.8.json'),
  minimist: m('minimist_1.2.8.json'),
  deepExtend: m('deep-extend_0.6.0.json'),
  stripComments: m('strip-json-comments_2.0.1.json'),
  ffmpegStatic: m('ffmpeg-static_4.4.1.json'),
  ffmpegInstaller: m('_ffmpeg-installer_ffmpeg_1.1.0.json'),
  progress: m('progress_2.0.3.json'),
  envPaths: m('env-paths_2.2.1.json'),
  httpsProxyAgent: m('https-proxy-agent_5.0.1.json'),
  httpBasic: m('_derhuerst_http-basic_8.2.4.json'),
  caseless: m('caseless_0.12.0.json'),
  concatStream: m('concat-stream_1.6.2.json'),
  parseCacheControl: m('parse-cache-control_1.0.1.json'),
  httpResponseObject: m('http-response-object_3.0.2.json'),
  readableStream: m('readable-stream_2.3.8.json'),
  bufferFrom: m('buffer-from_1.1.2.json'),
  stringDecoder: m('string_decoder_1.1.1.json'),
  safeBuffer: m('safe-buffer_5.1.2.json'),
  utilDeprecate: m('util-deprecate_1.0.2.json'),
  processNextick: m('process-nextick-args_2.0.1.json'),
  isarray: m('isarray_1.0.0.json'),
  coreUtilIs: m('core-util-is_1.0.3.json'),
  typedarray: m('typedarray_0.0.6.json'),
};

// node 条目构造器：许可证直接取 registry 元数据（parse-cache-control 无 license -> UNKNOWN）
function node(pkg, {dev = false, optional = false} = {}) {
  const e = {version: pkg.version};
  if (pkg.license) e.license = pkg.license;
  else e.license = 'UNKNOWN'; // 元数据未声明
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) e.dependencies = {...pkg.dependencies};
  if (dev) e.dev = true;
  if (optional) e.optional = true;
  return e;
}

// 根包：同时声明 finalhandler（普通）与 socket.io-parser（普通）、rimraf/tmp（开发）、
// ffmpeg-static（可选）。版本范围沿用真实 package.json 写法。
const root = {
  name: 'audit-demo-app',
  version: '2.4.0',
  dependencies: {
    finalhandler: '^1.1.2',
    'socket.io-parser': '~4.2.4',
    JSONStream: '^1.3.5',
    'es6-weak-map': '^2.0.3',
    jszip: '^3.10.1',
  },
  devDependencies: {
    rimraf: '^3.0.2',
    tmp: '^0.0.33',
    rc: '^1.2.8',
    esniff: '^1.1.0',
  },
  optionalDependencies: {
    'ffmpeg-static': '^4.4.1',
    '@ffmpeg-installer/ffmpeg': '1.1.0',
  },
};

const packages = {'': root};
const P = (path, pkg, opts) => { packages[`node_modules/${path}`] = node(pkg, opts); };
const N = (path, pkg, opts) => { packages[path] = node(pkg, opts); }; // 显式完整 key

// ---- 普通链 A：finalhandler（嵌套 debug@2.6.9 + ms@2.0.0 形成多版本）----
P('finalhandler', M.finalhandler);
N('node_modules/finalhandler/node_modules/debug', M.debug269);
N('node_modules/finalhandler/node_modules/debug/node_modules/ms', M.ms200);
P('unpipe', M.unpipe);
P('parseurl', M.parseurl);
P('statuses', M.statuses15);
P('encodeurl', M.encodeurl);
P('escape-html', M.escapeHtml);
P('on-finished', M.onFinished);
P('ee-first', M.eeFirst);

// ---- 普通链 B：socket.io-parser -> debug@4 / agent-base -> debug@4（共享）----
P('socket.io-parser', M.socketParser);
P('debug', M.debug434);
P('ms', M.ms213);
P('@socket.io/component-emitter', M.componentEmitter);
P('agent-base', M.agentBase);

// ---- 普通链 C：es6-weak-map（真实 es5-ext 环路簇）----
P('es6-weak-map', M.es6WeakMap);
P('es6-iterator', M.es6Iterator);
P('es6-symbol', M.es6Symbol);
P('es5-ext', M.es5Ext);
P('d', M.d);
P('type', M.type12);
P('ext', M.ext);
N('node_modules/ext/node_modules/type', M.type273); // 真实多版本：d 用 type@1，ext 用 type@2
P('next-tick', M.nextTick);
// esniff / event-emitter 由 es5-ext 簇的真实依赖引用，挂在顶层；
// esniff 额外承担审计注入演示（见 auditInject）。
P('esniff', M.esniff, {dev: true});
P('event-emitter', M.eventEmitter); // 真实包，但无任何父节点引用（缺失父节点）

// ---- 开发链：rimraf -> glob 深路径 + 大量共享节点；tmp 短链 ----
P('rimraf', M.rimraf, {dev: true});
P('glob', M.glob, {dev: true});
P('once', M.once, {dev: true});
P('inflight', M.inflight, {dev: true});
P('inherits', M.inherits, {dev: true});
P('minimatch', M.minimatch, {dev: true});
P('brace-expansion', M.braceExpansion, {dev: true});
P('concat-map', M.concatMap, {dev: true});
P('balanced-match', M.balancedMatch, {dev: true});
P('fs.realpath', M.fsRealpath, {dev: true});
P('path-is-absolute', M.pathIsAbsolute, {dev: true});
P('wrappy', M.wrappy, {dev: true});
P('tmp', M.tmp, {dev: true});
P('os-tmpdir', M.osTmpdir, {dev: true});

// statuses@1.4.0 故意放在 rimraf 嵌套目录：没有任何父节点的依赖范围指向它（缺失父节点）
N('node_modules/rimraf/node_modules/statuses', M.statuses14, {dev: true});

// ---- 普通 OR：JSONStream (MIT OR Apache-2.0) ----
P('JSONStream', M.jsonStream);
P('through', M.through);
P('jsonparse', M.jsonparse);

// ---- 普通 OR+著佐权：jszip (MIT OR GPL-3.0-or-later)，闭源下选 MIT 即可规避 ----
P('jszip', M.jszip);
P('lie', M.lie);
P('pako', M.pako);               // (MIT AND Zlib)：真实 AND 表达式
P('setimmediate', M.setImmediate);
P('immediate', M.immediate);
// jszip 同时依赖 readable-stream（与 ffmpeg 簇共享），形成跨簇共享节点

// ---- 开发 OR：rc (BSD-2-Clause OR MIT OR Apache-2.0) ----
P('rc', M.rc, {dev: true});
P('ini', M.ini, {dev: true});
P('minimist', M.minimist, {dev: true});
P('deep-extend', M.deepExtend, {dev: true});
P('strip-json-comments', M.stripComments, {dev: true});

// ---- 可选 GPL 链：ffmpeg-static（GPL-3.0-or-later，闭源分发冲突）----
P('ffmpeg-static', M.ffmpegStatic, {optional: true});
// @ffmpeg-installer/ffmpeg（真实 LGPL-2.1）：其 8 个平台二进制为 optionalDependencies，
// 锁文件刻意不安装它们 -> 8 条 optional 缺失目标边（npm 跨平台锁文件的真实形态）
{
  const inst = M.ffmpegInstaller;
  packages['node_modules/@ffmpeg-installer/ffmpeg'] = {
    version: inst.version, license: inst.license, optional: true,
    // 8 个平台二进制全部是可选依赖，当前平台之外均不安装 -> 缺失目标边
    optionalDependencies: inst.optionalDependencies,
  };
}
P('progress', M.progress, {optional: true});
P('env-paths', M.envPaths, {optional: true});
P('https-proxy-agent', M.httpsProxyAgent, {optional: true}); // 与 socket 链共享 debug@4
P('@derhuerst/http-basic', M.httpBasic, {optional: true});
P('caseless', M.caseless, {optional: true});
P('concat-stream', M.concatStream, {optional: true});
P('parse-cache-control', M.parseCacheControl, {optional: true}); // registry 无 license 字段
P('http-response-object', M.httpResponseObject, {optional: true}); // devDeps @types/node 未安装 -> 缺失目标
P('readable-stream', M.readableStream, {optional: true});
P('buffer-from', M.bufferFrom, {optional: true});
P('typedarray', M.typedarray, {optional: true});
P('string_decoder', M.stringDecoder, {optional: true});
P('safe-buffer', M.safeBuffer, {optional: true});
P('util-deprecate', M.utilDeprecate, {optional: true});
P('process-nextick-args', M.processNextick, {optional: true});
P('isarray', M.isarray, {optional: true});
P('core-util-is', M.coreUtilIs, {optional: true});

const ecosystem = {
  id: 'ecosystem',
  name: 'audit-demo-app',
  version: '2.4.0',
  label: '真实生态示例（registry 元数据）',
  note: '依赖范围、版本、许可证均取自 npm registry 真实发布；演示用注入边见 auditInject。',
  lockfileVersion: 3,
  requires: true,
  packages,
  // 审计注入：显式演示两类无法靠"干净元数据"自然产生、但审计中必须识别的脏数据。
  auditInject: [
    // 自引用：esniff 声明依赖自己（真实脏数据形态：发布者误把自己写进 dependencies）
    {from: 'esniff', name: 'esniff', range: '^1.1.0', kind: 'prod'},
    // 完全重复边：concat-stream -> inherits 在 dependencies 中声明了两次
    {from: 'concat-stream', name: 'inherits', range: '^2.0.3', kind: 'prod', duplicate: true},
  ],
};

const workspaceLock = JSON.parse(readFileSync(join(here, '..', 'package-lock.json'), 'utf8'));
const workspace = {
  id: 'workspace',
  label: '当前工作区（package-lock.json）',
  note: '本项目实际锁文件，vite/rolldown 工具链，含 MPL-2.0、Apache-2.0 与平台 optional 二进制。',
  ...workspaceLock,
};

mkdirSync(join(here, '..', 'src', 'data'), {recursive: true});
writeFileSync(
  join(here, '..', 'src', 'data', 'datasets.json'),
  JSON.stringify({workspace, ecosystem}, null, 2),
);
console.log('ecosystem nodes:', Object.keys(packages).length - 1);
console.log('workspace nodes:', Object.keys(workspaceLock.packages).length - 1);
