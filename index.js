const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performConnectionTask } = require('./linkedin');
const { performWorkdayApplication } = require('./workday/index');
const { startCloudflareTunnel } = require('./cloudflareTunnel');
const { loadLocalProfile, validateWorkdayProfile } = require('./workday/loadProfile');
const {
    loadState,
    ensureStateLoaded,
    createJob,
    updateJob,
    getState,
} = require('./stateStore');

// Download a presigned resume URL to a local file so the browser can upload it.
// Returns the absolute path to the downloaded file, or null on failure.
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

// Feature flag: set to false to disable Cloudflare Quick Tunnel
const ENABLE_CLOUDFLARE_TUNNEL = false;

const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

async function runLinkedInTask(payload) {
    try {
        await updateJob({ referral_id: payload.referral_id, state: 'running', error: null });
        await performConnectionTask(payload, async (update) => {
            await updateJob({ referral_id: payload.referral_id, ...update });
        });
        await updateJob({ referral_id: payload.referral_id, state: 'completed', error: null });
    } catch (error) {
        await updateJob({ referral_id: payload.referral_id, state: 'failed', error: error.message });
    }
}

async function runWorkdayTask(payload) {
    // stateStore keys by `referral_id`; we reuse that column for application_id
    // so workday jobs live in the same jobs table without a schema change.
    const id = payload.application_id;
    try {
        await updateJob({ referral_id: id, state: 'running', error: null });
        await performWorkdayApplication(payload, async (update) => {
            await updateJob({ referral_id: id, ...update });
        });
        await updateJob({ referral_id: id, state: 'completed', error: null });
    } catch (error) {
        await updateJob({ referral_id: id, state: 'failed', error: error.message });
    }
}

app.get('/health', async (_req, res) => {
    try {
        await ensureStateLoaded();
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/run-task', async (req, res) => {
    try {
        const payload = req.body || {};
        console.log('Received task payload:', payload);
        console.log('Content-Type:', req.get('content-type'));
        const { message, linkedin_url, referral_name, user_name, referral_id } = payload;

        if (!referral_id) {
            return res.status(400).json({ success: false, error: 'referral_id is required' });
        }

        await createJob({
            message,
            linkedin_url,
            referral_name,
            user_name,
            referral_id,
        });

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
        const application_id = rawPayload.application_id || rawPayload.task_id;
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

        // Download the resume from the presigned URL in the request body and
        // point the profile at the local copy so the upload step can use it.
        const presignedResumeUrl = rawPayload.resume_url || rawPayload.resumeUrl || rawPayload.presigned_url;
        const downloadedResumePath = await downloadResumeFromUrl(presignedResumeUrl, application_id);
        if (downloadedResumePath) {
            profile.resumeFilePath = downloadedResumePath;
        }

        const payload = { application_id, job_url, profile };

        // Persist a lightweight record — skip the credentials so we don't
        // write plaintext passwords to state.json.
        const { password: _pw, ...safeProfile } = profile;
        await createJob({
            referral_id: application_id,
            kind: 'workday',
            application_id,
            job_url,
            profile: safeProfile,
        });

        void runWorkdayTask(payload);

        return res.status(202).json({ success: true, application_id, state: 'queued' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/task-status/:id', async (req, res) => {
    try {
        const record = await getState(req.params.id);
        if (!record) return res.status(404).json({ success: false, error: 'not found' });
        return res.json({ success: true, result: record });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/result-update', async (req, res) => {
    try {
        const { referral_id, state, error } = req.body;

        if (!referral_id) {
            return res.status(400).json({ success: false, error: 'referral_id is required' });
        }

        const updated = await updateJob({ referral_id, state, error: error || null });
        return res.json({ success: true, result: updated });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

(async () => {
    await loadState();

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
