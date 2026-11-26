// scripts/assemble-mod.mjs
// Assembles dist-mod/spolyric/, a Folia mod folder the user can copy into %APPDATA%\Folia\mods
// (or drop as a zip on the mods panel). The mod's main entry starts Spolyric with Folia.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const outRoot = path.join(root, 'dist-mod');
const modDir = path.join(outRoot, 'spolyric');
const runtimeDir = path.join(modDir, 'runtime');

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(runtimeDir, { recursive: true });

// The daemon: the compiled build plus the two PowerShell scripts, which sit beside their compiled files.
fs.cpSync(path.join(root, 'dist', 'src'), path.join(runtimeDir, 'src'), { recursive: true });
fs.writeFileSync(
    path.join(runtimeDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
);
// A copy of the license and a short readme travel with it.
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(modDir, 'LICENSE.txt'));

fs.copyFileSync(path.join(root, 'mod', 'main.cjs'), path.join(modDir, 'main.cjs'));
fs.copyFileSync(path.join(root, 'mod', 'client.mjs'), path.join(modDir, 'client.mjs'));
fs.copyFileSync(path.join(root, 'mod', 'preview.jpg'), path.join(modDir, 'preview.jpg'));

const manifest = {
    folium: 2,
    folia: '>=0.8.0',
    id: 'spolyric',
    name: 'Spolyric — 免费 Spotify 跟随',
    version: pkg.version,
    author: 'Spolyric',
    description: '免费 Spotify 账号也能用的 Folia 舞台跟随器：读取 Windows 上 Spotify 桌面端正在播放的歌，把歌名、歌手、封面、进度和歌词送进 Folia 舞台。不需要会员，也不用在模组里登录 Spotify；它不播放音频，只做跟随。必须打开「舞台模式」并把来源选为 Stage API，普通播放页不显示；它和 Folia 内置的 Spotify 音源不是一回事。',
    main: 'main.cjs',
    client: 'client.mjs',
    permissions: [],
    repository: 'https://github.com/NeverNG/spolyric',
    bugs: 'https://github.com/NeverNG/spolyric/issues',
    preview: 'preview.jpg',
};
fs.writeFileSync(path.join(modDir, 'mod.json'), `${JSON.stringify(manifest, null, 2)}\n`);

fs.writeFileSync(path.join(modDir, 'README.md'), [
    "# Spolyric — 免费 Spotify 跟随",
    "",
    "**让免费 Spotify 账号也能用 Folia 的舞台歌词。** 它读取 Windows 上 Spotify 桌面端正在播放的歌，",
    "把歌名、歌手、封面、进度和歌词送进 Folia 的舞台；不需要 Spotify 会员，也不需要在这个模组里登录 Spotify。",
    "",
    "它**不播放音频**：声音仍由 Spotify 桌面端播放，Spolyric 只做跟随和显示。",
    "",
    "## ⚠️ 必须打开舞台模式",
    "",
    "1. Folia → 设置 → 连接与集成 → 打开「舞台模式」；",
    "2. 舞台来源选 **Stage API**；",
    "3. 进入舞台。普通播放页、桌面歌词、模组面板都不会显示 Spolyric 的内容。",
    "",
    "## 和 Folia 内置的 Spotify 音源不一样",
    "",
    "| | 内置 Spotify 音源 | Spolyric |",
    "| --- | --- | --- |",
    "| 免费账号 | ❌ 播放会提示需要会员 | ✅ 可以用 |",
    "| 在 Folia 里登录 Spotify | 要 | 不要 |",
    "| 声音由谁放 | Folia（librespot / Soloist） | Spotify 桌面端 |",
    "| 歌从哪来 | 在 Folia 里搜索、点播 | 跟随 Spotify 正在放的歌 |",
    "| 效果出现在哪 | 播放页 + 舞台 | 只在舞台 |",
    "| 需要舞台模式 | 不需要 | **必须** |",
    "",
    "两个不要同时用：内置音源在播时，Spolyric 再往舞台推会覆盖它的状态。免费账号请关掉内置音源。",
    "",
    "## 功能",
    "",
    "- **歌词**：首选源默认 QQ（和 Folia 一样），顺序是 QQ → 网易云 → 酷狗 → Spotify → LRCLIB，第一个匹配就用（匹配前会做繁体转简体）；",
    "  可以用命令行 `--prefer` 改首选源。匹配不到就不放歌词，不编造。",
    "- **封面**：按标题 + 歌手 + 时长在 iTunes / QQ 音乐 / Deezer 匹配，下载后由本机的 loopback 服务提供给 Folia；匹配不到就不放。",
    "- **播放控制**：舞台的播放/暂停和进度条会作用到 Spotify；进度条两端另有 `⏮` / `⏭` 两个按钮",
    "  （Folia 在舞台上下文里关掉了它自带的上一首/下一首）。",
    "- **快捷键**：`Ctrl+Alt+←` 上一首、`Ctrl+Alt+→` 下一首、`Ctrl+Alt+空格` 播放/暂停。",
    "- **时间同步**：每 0.5 秒采样，舞台自己按时间外推；歌词整体偏早/偏晚可用 `--offset <毫秒>` 平移。",
    "",
    "## 安装",
    "",
    "1. Folia → 设置 → 模组，打开「社区模组」；",
    "2. 在模组市场点安装，或把 `spolyric` 文件夹放进 `%APPDATA%\\Folia\\mods`（也可以把 zip 拖到模组面板）；",
    "3. 在模组列表里启用 Spolyric（会弹一次确认）。",
    "",
    "之后每次启动 Folia 都会自动拉起 Spolyric；禁用模组或退出 Folia 时它随之停止。",
    "",
    "## 它在本机做什么（权限与外部程序说明）",
    "",
    "- 模组本身**不申请任何 Folia 权限**，不读 Folia 账号，也不上传用户数据。",
    "- 主入口会启动一个 `runtime/src/main.js` 子进程（Spolyric 本体），并通过 PowerShell 调用 Windows 媒体会话（SMTC）：",
    "  读取 Spotify 正在放什么，以及发送播放/暂停/切歌命令。",
    "- 为了把封面交给只接受 http(s) 的舞台，会在 `127.0.0.1` 的随机端口起一个只读的封面服务，仅提供已缓存的封面。",
    "- 数据在 `%APPDATA%\\Spolyric`（配置、token、歌词与封面缓存），和单独运行 `spolyric run` 是同一份。",
    "- 联网请求：歌词查 QQ / 网易云 / 酷狗 / LRCLIB，封面查 iTunes / Deezer；只发歌名、歌手、时长，不带账号信息。",
    "  可用 `--lyrics lrclib` 只保留 LRCLIB。",
    "- 系统级快捷键由模组主入口注册，不修改 Folia 自己的快捷键。",
    "",
    "## 限制",
    "",
    "- 只支持 Windows + Spotify 桌面端；手机/别的设备需要 Web API（应用 owner 要有 Premium）。",
    "- 不识别广告，广告期间可能没有歌词或匹配不到封面。",
    "- 上一首/下一首只能用模组加的进度条按钮或快捷键；Folia 自带的两个按钮在舞台模式下不可用。",
    "- 封面来自公开目录，冷门歌可能没有。",
    "",
    "## 排错",
    "",
    "- 没效果：确认舞台模式已开、来源是 Stage API，并进入舞台。",
    "- 提示「同一份数据目录已经有 Spolyric 在运行」：先停掉终端里的 `spolyric run`。",
    "- 舞台按钮状态偶尔回跳：升级到包含暂停状态修复的版本；旧配置会在启动时自动迁移时间参数。",
    "- 模组面板能看到 Spolyric 的日志；`runtime/src/main.js run --verbose` 可手动对照。",
    "",
    "## 仓库与反馈",
    "",
    "源码与问题反馈见仓库主页；发行版由维护者签名后上架模组市场。",
    ""
].join('\n'));

// Validate against Folia's own manifest validator when the reference checkout is around.
try {
    const { validateManifest } = require(path.join(root, 'reference', 'folia', 'electron', 'modSystem', 'manifest.cjs'));
    const result = validateManifest(JSON.parse(fs.readFileSync(path.join(modDir, 'mod.json'), 'utf8')));
    if (!result.ok) {
        console.error('mod.json did not pass Folia\'s validator:', result.errors);
        process.exitCode = 1;
    } else {
        console.log('mod.json passed Folia\'s validator');
    }
} catch {
    // No reference checkout: nothing to validate against.
}

// A zip is what the mods panel accepts by drag and drop.
const zip = path.join(outRoot, 'spolyric.zip');
const zipped = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${modDir}' -DestinationPath '${zip}' -Force`,
], { stdio: 'ignore' });
if (zipped.status === 0) console.log(`zip: ${path.relative(root, zip)}`);
else console.warn('zip was not made; copy the folder instead');

console.log(`mod folder: ${path.relative(root, modDir)}`);
console.log('Copy it into %APPDATA%\\Folia\\mods, enable "community mods", then enable Spolyric.');
