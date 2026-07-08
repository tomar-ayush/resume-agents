const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function extractCloudflareUrl(output) {
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi);
    return match?.[0] || null;
}

function resolveCloudflareCommand() {
    if (process.env.CLOUDFLARE_TUNNEL_BIN) {
        return { command: process.env.CLOUDFLARE_TUNNEL_BIN, args: [] };
    }

    const localBin = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'cloudflared.cmd' : 'cloudflared');
    if (fs.existsSync(localBin)) {
        return { command: localBin, args: [] };
    }

    const localScript = path.join(__dirname, 'node_modules', 'cloudflared', 'lib', 'cloudflared.js');
    if (fs.existsSync(localScript)) {
        return { command: process.execPath, args: [localScript] };
    }

    return { command: process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared', args: [] };
}

function startCloudflareTunnel({ port, host = '127.0.0.1', logger = console } = {}) {
    if (process.env.DISABLE_CLOUDFLARE_TUNNEL === '1' || process.env.DISABLE_CLOUDFLARE_TUNNEL === 'true') {
        logger.info('Cloudflare Quick Tunnel disabled via environment variable.');
        return Promise.resolve(null);
    }

    const { command, args: baseArgs } = resolveCloudflareCommand();
    const args = [...baseArgs, 'tunnel', '--url', `http://${host}:${port}`, '--no-autoupdate'];

    logger.info(`Starting Cloudflare Quick Tunnel with: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let stdout = '';
    let stderr = '';

    return new Promise((resolve) => {
        const finalize = (url) => {
            if (settled) {
                return;
            }
            settled = true;
            if (url) {
                logger.info(`Cloudflare Quick Tunnel ready: ${url}`);
            } else {
                logger.warn('Cloudflare Quick Tunnel did not report a public URL.');
            }
            resolve(url);
        };

        const onData = (chunk, streamName) => {
            const text = chunk.toString();
            if (streamName === 'stdout') {
                stdout += text;
            } else {
                stderr += text;
            }

            const url = extractCloudflareUrl(stdout) || extractCloudflareUrl(stderr);
            if (url) {
                finalize(url);
            }
        };

        child.stdout?.on('data', (chunk) => onData(chunk, 'stdout'));
        child.stderr?.on('data', (chunk) => onData(chunk, 'stderr'));

        child.on('error', (error) => {
            logger.warn(`Cloudflare Quick Tunnel failed to start: ${error.message}`);
            finalize(null);
        });

        child.on('exit', (code, signal) => {
            if (!settled) {
                logger.warn(`Cloudflare Quick Tunnel exited before a URL was reported (code=${code}, signal=${signal}).`);
                finalize(null);
            }
        });

        setTimeout(() => {
            if (!settled) {
                finalize(null);
            }
        }, 20000);
    });
}

module.exports = {
    extractCloudflareUrl,
    startCloudflareTunnel,
};
