/**
 * POST /api/contact
 * 1. Telegram xabar yuboradi (agar sozlangan bo'lsa)
 * 2. Email yuboradi via Formspree (agar sozlangan bo'lsa)
 * 3. amoCRM ga lead yaratadi (agar token bo'lsa)
 */

import nodemailer from 'nodemailer';

const REPO_RAW = 'https://raw.githubusercontent.com/nuraddinov477/resta.uz/main/integration-config.json';

async function getConfig() {
    try {
        const res = await fetch(REPO_RAW + '?t=' + Date.now());
        if (res.ok) return await res.json();
    } catch (_) {}
    return {};
}

async function sendTelegram(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
}

async function sendEmail(config, name, phone, message) {
    if (config.formspree_id) {
        await fetch(`https://formspree.io/f/${config.formspree_id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, message, _replyto: config.email_to })
        });
        return;
    }
    if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
        });
        await transporter.sendMail({
            from: `"RESTA Sayt" <${process.env.GMAIL_USER}>`,
            to: config.email_to || 'abbosmirziyoyev1@gmail.com',
            subject: `Yangi murojaat: ${name} — ${phone}`,
            html: `<h2 style="color:#1a3575">Yangi murojaat — RESTA sayt</h2>
                   <p><b>Ism:</b> ${name}</p>
                   <p><b>Telefon:</b> <a href="tel:${phone}">${phone}</a></p>
                   ${message ? `<p><b>Xabar:</b> ${message}</p>` : ''}`
        });
    }
}

// amoCRM helpers
const SUBDOMAIN   = process.env.AMOCRM_SUBDOMAIN || 'restacompany';
const PIPELINE_ID = parseInt(process.env.AMOCRM_PIPELINE_ID || '32149382');
const BASE_URL    = `https://${SUBDOMAIN}.amocrm.ru`;

async function amoRequest(path, payload, token) {
    return fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).end();

    const { name, phone, message } = req.body || {};
    if (!name || !phone) return res.status(400).json({ error: 'name va phone majburiy' });

    // Config GitHub dan
    const config = await getConfig();

    try {
        // 1. Telegram
        if (config.telegram_token && config.telegram_chat_id) {
            const text = `📩 <b>Yangi murojaat — RESTA sayt</b>\n\n` +
                         `👤 <b>Ism:</b> ${name}\n` +
                         `📞 <b>Telefon:</b> ${phone}` +
                         (message ? `\n💬 <b>Xabar:</b> ${message}` : '');
            await sendTelegram(config.telegram_token, config.telegram_chat_id, text).catch(console.error);
        }

        // 2. Email
        if (config.email_to || config.formspree_id || process.env.GMAIL_USER) {
            await sendEmail(config, name, phone, message).catch(console.error);
        }

        // 3. amoCRM
        const TOKEN = process.env.AMOCRM_TOKEN;
        if (TOKEN) {
            const contactRes = await amoRequest('/api/v4/contacts', [{
                name,
                custom_fields_values: [{ field_code: 'PHONE', values: [{ value: phone, enum_code: 'WORK' }] }]
            }], TOKEN);

            let contactId = null;
            if (contactRes.ok) {
                const data = await contactRes.json();
                contactId = data?._embedded?.contacts?.[0]?.id ?? null;
            }

            await amoRequest('/api/v4/leads', [{
                name: `${name} — Resta sayt`,
                pipeline_id: PIPELINE_ID,
                ...(contactId && { _embedded: { contacts: [{ id: contactId }] } })
            }], TOKEN);
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
