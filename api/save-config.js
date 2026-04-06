/**
 * POST /api/save-config
 * Saves integration settings to integration-config.json in GitHub repo
 */
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { telegram_token, telegram_chat_id, email_to, formspree_id } = req.body || {};

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN missing' });

    const REPO    = 'nuraddinov477/resta.uz';
    const FILE    = 'integration-config.json';
    const API_URL = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

    try {
        // Get current file SHA
        const current = await fetch(API_URL, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        const currentData = await current.json();
        const sha = currentData.sha;

        const newConfig = { telegram_token, telegram_chat_id, email_to, formspree_id };
        const content   = Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64');

        const updateRes = await fetch(API_URL, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Update integration config',
                content,
                sha
            })
        });

        if (!updateRes.ok) {
            const err = await updateRes.text();
            return res.status(502).json({ error: err });
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
