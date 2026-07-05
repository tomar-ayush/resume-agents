const express = require('express');
const path = require('node:path');
const { performConnectionTask } = require('./linkedin');
const {
    loadState,
    ensureStateLoaded,
    createJob,
    updateJob,
    getState,
} = require('./stateStore');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.text({ type: ['text/plain', 'text/*', 'application/*+json'] }));

app.use((req, _res, next) => {
    if (typeof req.body === 'string') {
        try {
            req.body = JSON.parse(req.body);
        } catch (_error) {
            req.body = { raw: req.body };
        }
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        req.body = {};
    }

    next();
});

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
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
})();
