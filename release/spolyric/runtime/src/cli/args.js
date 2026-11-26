// src/cli/args.ts
// The command line: one command and a handful of long options, parsed by hand so Spolyric has no dependencies.
export class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UsageError';
    }
}
const COMMANDS = ['run', 'login', 'logout', 'status', 'key', 'config', 'help', 'version'];
const KEY_ACTIONS = ['play-pause', 'play', 'pause', 'next', 'prev'];
const numberOption = (name, value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        throw new UsageError(`${name} needs a positive number, not "${value}"`);
    return Math.round(parsed);
};
const signedNumberOption = (name, value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        throw new UsageError(`${name} needs a number, not "${value}"`);
    return Math.round(parsed);
};
export function parseArgs(argv) {
    const options = {
        command: 'run',
        verbose: false,
        json: false,
        once: false,
        dryRun: false,
        noOpen: false,
        noControl: false,
    };
    let commandSeen = false;
    for (let index = 0; index < argv.length; index += 1) {
        const raw = argv[index] ?? '';
        if (!raw.startsWith('--')) {
            if (options.command === 'key' && options.keyAction === undefined) {
                const action = raw;
                if (!KEY_ACTIONS.includes(action))
                    throw new UsageError(`Unknown key action "${raw}". Try: play-pause, next, prev`);
                options.keyAction = action;
                continue;
            }
            const name = raw;
            if (!COMMANDS.includes(name))
                throw new UsageError(`Unknown command "${raw}". Try: spolyric --help`);
            options.command = name;
            commandSeen = true;
            continue;
        }
        const separator = raw.indexOf('=');
        const flag = separator === -1 ? raw : raw.slice(0, separator);
        const inline = separator === -1 ? undefined : raw.slice(separator + 1);
        const take = () => {
            if (inline !== undefined)
                return inline;
            const next = argv[index + 1];
            if (next === undefined || next.startsWith('--'))
                throw new UsageError(`${flag} needs a value`);
            index += 1;
            return next;
        };
        switch (flag) {
            case '--help':
                options.command = 'help';
                return options;
            case '--version':
                options.command = 'version';
                return options;
            case '--client-id':
                options.clientId = take();
                break;
            case '--source': {
                const value = take().toLowerCase();
                if (value !== 'auto' && value !== 'web' && value !== 'local') {
                    throw new UsageError('--source takes auto, web or local');
                }
                options.source = value;
                break;
            }
            case '--port':
                options.port = numberOption(flag, take());
                break;
            case '--poll':
                options.pollMs = numberOption(flag, take());
                break;
            case '--clock':
                options.clockMs = numberOption(flag, take());
                break;
            case '--connection':
                options.connection = take();
                break;
            case '--stage-url':
                options.stageUrl = take();
                break;
            case '--stage-token':
                options.stageToken = take();
                break;
            case '--lyrics':
                options.lyrics = take().split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
                break;
            case '--offset':
                options.offsetMs = signedNumberOption(flag, take());
                break;
            case '--prefer': {
                const value = take().toLowerCase();
                if (!['qq', 'netease', 'kugou', 'spotify', 'lrclib'].includes(value)) {
                    throw new UsageError('--prefer takes qq, netease, kugou, spotify or lrclib');
                }
                options.prefer = value;
                break;
            }
            case '--verbose':
                options.verbose = true;
                break;
            case '--json':
                options.json = true;
                break;
            case '--once':
                options.once = true;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--no-open':
                options.noOpen = true;
                break;
            case '--no-control':
                options.noControl = true;
                break;
            default:
                throw new UsageError(`Unknown option "${flag}". Try: spolyric --help`);
        }
    }
    if (!commandSeen && argv.length === 0)
        options.command = 'run';
    return options;
}
export const USAGE = `Spolyric — 把 Spotify 正在播放的歌送到 Folia 的舞台，用 Folia 自己的歌词视觉效果显示

用法:
  spolyric login  [--client-id ID] [--port 9888]   登录 Spotify（用你自己的 Spotify 开发者应用）
  spolyric run    [--once] [--dry-run] [--verbose]  跟随 Spotify，把歌、封面、进度和歌词送到 Folia
  spolyric status [--json]                          看一眼 Folia 连接和 Spotify 正在播放什么
  spolyric key <play-pause|next|prev>               控制本机 Spotify（不需要 Folia）
  spolyric logout                                   忘掉本机存着的 Spotify 登录
  spolyric config [--json]                          显示设置文件位置与最终生效的设置
  spolyric --help | --version

常用选项:
  --source <auto|web|local>  播放状态从哪来：auto（默认，先试 Web API）、web、local（本机 Spotify 的媒体会话，Windows）
  --no-control          关闭「Folia 舞台的播放/暂停/进度条控制本机 Spotify」
  --connection <path>   指定 Folia 的 stage/connection.json（默认自动找）
  --stage-url <url>     直接给 Stage API 地址（配合 --stage-token）
  --poll <ms>           问 Spotify 的间隔，默认 1000
  --clock <ms>          给 Folia 校时的间隔，默认 2000
  --offset <ms>         歌词整体平移多少毫秒（正数延后、负数提前），默认 0
  --lyrics <list>       歌词来源，spotify,netease,qq,kugou,lrclib（默认全开）
  --prefer <source>     优先歌词源 qq / netease / kugou / spotify / lrclib（默认 qq，和 Folia 一致）
  --once                只跑一步就退出（排错用）
  --dry-run             不向 Folia 推送，只打印将要推送的内容

环境变量:
  SPOLYRIC_CLIENT_ID          Spotify 开发者应用的 Client ID
  SPOLYRIC_SOURCE             auto / web / local，同 --source
  SPOLYRIC_CONTROL            off 关闭舞台按钮控制
  SPOLYRIC_HOME               数据目录（默认 %APPDATA%\\Spolyric）
  SPOLYRIC_FOLIA_DATA         Folia 的数据目录（便携版/多份安装时指定）
  SPOLYRIC_CONNECTION         Stage 连接文件路径
  SPOLYRIC_STAGE_URL / SPOLYRIC_STAGE_TOKEN   直接指定 Stage API
  SPOLYRIC_SPOTIFY_API_BASE / SPOLYRIC_SPOTIFY_LYRICS_BASE / SPOLYRIC_LRCLIB_BASE   换接口地址（测试用）
  SPOLYRIC_NETEASE_BASE       网易云接口地址（默认 https://music.163.com）
  SPOLYRIC_PROXY              代理（默认读 HTTPS_PROXY 或 Windows 系统代理；none 表示直连）
  SPOLYRIC_OFFSET_MS          歌词平移毫秒数，同 --offset
  SPOLYRIC_PREFER             优先歌词源，同 --prefer
  SPOLYRIC_POLL_MS / SPOLYRIC_CLOCK_MS   采样与校时间隔
  SPOLYRIC_VERBOSE=1          详细日志`;
//# sourceMappingURL=args.js.map