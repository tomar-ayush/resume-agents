const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performConnectionTask, buildCallbackPayload } = require('./linkedin');
const { performWorkdayApplication } = require('./workday/index');
const { startCloudflareTunnel } = require('./cloudflareTunnel');
const { loadLocalProfile, validateWorkdayProfile } = require('./workday/loadProfile');

const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors({
    origin: ["https://applyai-agent.vercel.app", "http://localhost:3000"],
    credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));


async function downloadResumeFromUrl(presignedUrl, applicationId) {
    if (!presignedUrl) {
        console.warn('[resume] no presigned URL provided — skipping download');
        return null;
    }
    console.log('[resume] presigned URL:', presignedUrl);
    try {
        const res = await fetch(presignedUrl);
        console.log('[resume] download response status:', res.status, res.statusText);
        if (!res.ok) {
            console.warn('[resume] download failed:', res.status, res.statusText);
            return null;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const fileName = `resume.pdf`;
        const outDir = path.join(__dirname, 'resources');
        await fs.mkdir(outDir, { recursive: true });
        const outPath = path.join(outDir, fileName);
        await fs.writeFile(outPath, buf);
        console.log('[resume] downloaded to', outPath, `(${buf.length} bytes)`);
        return outPath;
    } catch (error) {
        console.warn('[resume] download error:', error.message);
        return null;
    }
}


const CALLBACK_STATE = {
    linkedin: { completed: 'linkedin_completed', failed: 'linkedin_failed' },
    workday: { completed: 'workday_completed', failed: 'workday_failed' },
};


async function sendCallback(callbackUrl, token, state, extra = {}) {
    if (!callbackUrl) {
        console.warn('[callback] no callback_url provided — skipping');
        return;
    }
    try {
        const body = buildCallbackPayload({ state, token, ...extra });
        console.log('[callback] POST', callbackUrl, JSON.stringify(body));
        const res = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        console.log('[callback] response', res.status, res.statusText);
    } catch (error) {
        console.warn('[callback] request failed:', error.message);
    }
}

// Feature flag: set to false to disable Cloudflare Quick Tunnel
const ENABLE_CLOUDFLARE_TUNNEL = true;


async function runLinkedInTask(payload) {
    try {
        await performConnectionTask(payload, async () => { });
        await sendCallback(payload.callback_url, payload.callback_token, CALLBACK_STATE.linkedin.completed, { task_id: payload.task_id });
    } catch (error) {
        await sendCallback(payload.callback_url, payload.callback_token, CALLBACK_STATE.linkedin.failed, { task_id: payload.task_id, error: error.message });
    }
}


async function runWorkdayTask(payload) {
    try {
        await performWorkdayApplication(payload, async () => { });
        await sendCallback(payload.callback_url, payload.callback_token, CALLBACK_STATE.workday.completed);
    } catch (error) {
        await sendCallback(payload.callback_url, payload.callback_token, CALLBACK_STATE.workday.failed, { error: error.message });
    }
}


app.get('/health', async (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


app.post('/run-task', async (req, res) => {
    try {
        const payload = req.body;
        console.log('Received task payload:', payload);
        const { message, linkedin_url, referral_name, user_name, referral_id } = payload;

        if (!referral_id) {
            return res.status(400).json({ success: false, error: 'referral_id is required' });
        }

        void runLinkedInTask(payload);

        return res.status(202).json({ success: true, referral_id, state: 'queued' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});


app.post('/run-workday-task', async (req, res) => {
    try {
        const rawPayload = req.body;
        console.log('Received workday task payload:', rawPayload);
        // Accept either `application_id` or `task_id` as the job identifier.
        const application_id = rawPayload.task_id;
        const { job_url } = rawPayload;

        console.log('Received workday task:', { application_id, job_url });

        if (!application_id) {
            return res.status(400).json({ success: false, error: 'application_id (or task_id) is required' });
        }
        if (!job_url) {
            return res.status(400).json({ success: false, error: 'job_url is required' });
        }

        // All candidate data is pulled from the local information.js file.
        const profile = loadLocalProfile();
        const { valid, errors } = validateWorkdayProfile(profile);
        if (!valid) {
            return res.status(400).json({
                success: false,
                error: 'Local profile (information.js) validation failed',
                details: errors,
            });
        }

        const presignedResumeUrl = rawPayload.resume_url;
        const downloadedResumePath = await downloadResumeFromUrl(presignedResumeUrl, application_id);
        if (downloadedResumePath) {
            profile.resumeFilePath = downloadedResumePath;
        }

        const payload = {
            application_id,
            job_url,
            profile,
            callback_url: rawPayload.callback_url,
            callback_token: rawPayload.callback_token,
        };

        void runWorkdayTask(payload);

        return res.status(202).json({ success: true, application_id, state: 'queued' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});


(async () => {
    const server = app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);

        if (ENABLE_CLOUDFLARE_TUNNEL) {
            try {
                const tunnelUrl = await startCloudflareTunnel({ port: PORT });
                if (tunnelUrl) {
                    console.log(`Cloudflare Quick Tunnel available at ${tunnelUrl}`);
                }
            } catch (error) {
                console.warn('Cloudflare Quick Tunnel startup failed:', error.message);
            }
        } else {
            console.log('Cloudflare Quick Tunnel disabled (ENABLE_CLOUDFLARE_TUNNEL=false)');
        }
    });

    process.on('SIGTERM', () => {
        server.close(() => process.exit(0));
    });
})();
