// mod/main.cjs
// Spolyric as a Folia mod: Folia loads this entry in its main process at startup, and it starts one
// Spolyric child process. When the mod is disabled or Folia quits, the child is stopped with it.
//
// The main entry of a Folium mod runs in Node with full access, so `child_process` is allowed here.
// What it runs is the same CLI the user would start by hand (runtime/ is a copy of Spolyric's build).

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
// In Folia this is Electron; outside it (a smoke test) the shortcuts are simply not registered.
let globalShortcut = null;
try {
    ({ globalShortcut } = require('electron'));
} catch {
    globalShortcut = null;
}

module.exports = function activate(api) {
    const runtime = path.join(__dirname, 'runtime');
    const entry = path.join(runtime, 'src', 'main.js');
    if (!fs.existsSync(entry)) {
        api.log.error(`Spolyric 的运行文件缺失：${entry}`);
        return;
    }

    // The release runs exactly one command, the same `run` the CLI uses by hand. There is no
    // environment override for the executable or the arguments: a follower that can be pointed at
    // another binary is a different kind of tool, and the external-work review asked for the fixed
    // shape.
    const args = ['run'];
    const executable = process.execPath;
    let child;
    try {
        child = spawn(executable, [entry, ...args], {
            cwd: runtime,
            env: {
                ...process.env,
                // Folia's executable is Node too; this runs it as a plain Node process.
                ELECTRON_RUN_AS_NODE: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    } catch (error) {
        api.log.error('没能启动 Spolyric', error);
        return;
    }

    const forward = (stream, level) => {
        if (!stream) return;
        let buffer = '';
        stream.setEncoding('utf8');
        stream.on('data', chunk => {
            buffer += chunk;
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, '').trim();
                buffer = buffer.slice(newline + 1);
                if (line) api.log[level](line);
                newline = buffer.indexOf('\n');
            }
        });
    };
    forward(child.stdout, 'info');
    forward(child.stderr, 'info');

    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        try {
            child.kill();
        } catch {
            // already gone
        }
    };

    child.once('error', error => api.log.error('Spolyric 子进程出错', error));
    child.once('exit', (code, signal) => {
        if (!stopped) api.log.warn(`Spolyric 退出了（code ${code}${signal ? `, ${signal}` : ''}）`);
    });
    api.onDispose(stop);
    process.once('exit', stop);

    // Folia's stage bar has no next/previous in a stage session, so the mod puts the transport on
    // global shortcuts instead. The one-shot script is fine here: a hotkey press is not in a loop.
    const controlScript = path.join(runtime, 'src', 'media', 'controlSession.ps1');
    const sendKey = action => {
        if (!fs.existsSync(controlScript)) return;
        try {
            spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', controlScript,
                '-Action', action,
            ], { stdio: 'ignore', windowsHide: true });
        } catch (error) {
            api.log.warn(`没能发送 ${action}`, error);
        }
    };
    const registered = [];
    const register = (accelerator, action) => {
        if (!globalShortcut) return;
        try {
            if (globalShortcut.register(accelerator, () => sendKey(action))) registered.push(accelerator);
        } catch (error) {
            api.log.warn(`快捷键 ${accelerator} 注册失败`, error);
        }
    };
    register('Control+Alt+Left', 'prev');
    register('Control+Alt+Right', 'next');
    register('Control+Alt+Space', 'toggle');
    if (registered.length > 0) api.log.info(`播放快捷键：${registered.join(' · ')}`);

    // The client entry's two buttons beside the progress bar ask for a switch here.
    if (api.rpc && typeof api.rpc.handle === 'function') {
        api.rpc.handle('transport', action => {
            const allowed = ['next', 'prev', 'play', 'pause', 'toggle'];
            if (typeof action !== 'string' || !allowed.includes(action)) {
                throw new Error(`unsupported transport action: ${String(action)}`);
            }
            sendKey(action);
            return { ok: true };
        });
    }
    api.onDispose(() => {
        if (!globalShortcut) return;
        for (const accelerator of registered) {
            try {
                globalShortcut.unregister(accelerator);
            } catch {
                // already unregistered
            }
        }
    });
};
