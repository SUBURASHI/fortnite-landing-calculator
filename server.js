const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();

// Настройки сессии (чтобы помнить пользователя)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

// Раздаём статические файлы из папки public
app.use(express.static('public'));

// ========== СТРАНИЦЫ ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/premium', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'premium.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Дополнительные страницы (редирект на существующие)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'checkout.html'));
});
app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.get('/profile', (req, res) => {
    if (req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'profile.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== НАСТРОЙКИ DISCORD ==========
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = 'https://fortnite-landing-calculator.onrender.com/auth/discord/callback';
const DISCORD_SCOPE = 'identify email';

// 1. Отправляем пользователя в Discord для авторизации
app.get('/auth/discord', (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${DISCORD_SCOPE}`;
    res.redirect(authUrl);
});

// 2. Discord перенаправляет сюда после разрешения
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

        const access_token = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const user = userResponse.data;
        req.session.user = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            email: user.email,
            global_name: user.global_name,
            provider: 'discord'
        };
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Discord auth error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// ========== НАСТРОЙКИ EPIC GAMES ==========
const EPIC_CLIENT_ID = process.env.EPIC_CLIENT_ID;
const EPIC_CLIENT_SECRET = process.env.EPIC_CLIENT_SECRET;
const EPIC_REDIRECT_URI = 'https://fortnite-landing-calculator.onrender.com/auth/epic/callback';

// 1. Перенаправление на Epic Games
app.get('/auth/epic', (req, res) => {
    const authUrl = `https://www.epicgames.com/id/authorize?client_id=${EPIC_CLIENT_ID}&redirect_uri=${encodeURIComponent(EPIC_REDIRECT_URI)}&response_type=code&scope=basic_profile`;
    res.redirect(authUrl);
});

// 2. Колбэк Epic Games
app.get('/auth/epic/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');

    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', EPIC_REDIRECT_URI);

        const tokenResponse = await axios.post('https://api.epicgames.dev/epic/oauth/v2/token', 
            params,
            {
                auth: {
                    username: EPIC_CLIENT_ID,
                    password: EPIC_CLIENT_SECRET
                },
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const access_token = tokenResponse.data.access_token;
        
        const userResponse = await axios.get('https://api.epicgames.dev/epic/oauth/v2/userInfo', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const epicUser = userResponse.data;

        req.session.user = {
            id: epicUser.sub,
            username: epicUser.name || epicUser.preferred_username || 'Epic User',
            email: epicUser.email,
            provider: 'epic'
        };
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Epic auth error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// ========== ВЫХОД ==========
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ========== API ДЛЯ ПРОВЕРКИ АВТОРИЗАЦИИ ==========
app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// ========== API ДЛЯ ПРОВЕРКИ ПОДПИСКИ ==========
// Временное хранилище активных подписок (в реальном проекте используй БД)
const activeSubscriptions = new Map();

app.post('/api/activate-subscription', (req, res) => {
    const { userId, orderId } = req.body;
    if (userId) {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        activeSubscriptions.set(userId, { active: true, expiry: expiry.toISOString() });
        console.log(`✅ Подписка активирована для пользователя ${userId}`);
        res.json({ success: true, expiry: expiry.toISOString() });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/check-subscription', (req, res) => {
    const userId = req.session.user?.id || req.query.userId;
    if (userId && activeSubscriptions.has(userId)) {
        const sub = activeSubscriptions.get(userId);
        const isValid = sub.active && new Date(sub.expiry) > new Date();
        res.json({ subscribed: isValid, expiry: sub.expiry });
    } else {
        res.json({ subscribed: false });
    }
});

// Запускаем сервер
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
