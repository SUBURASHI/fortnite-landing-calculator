const express = require('express');
const session = require('express-session');
const axios = require('axios');
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

// Настройки Discord
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/auth/discord/callback';
const SCOPE = 'identify email';

// 1. Отправляем пользователя в Discord для авторизации
app.get('/auth/discord', (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${SCOPE}`;
    res.redirect(authUrl);
});

// 2. Discord перенаправляет сюда после разрешения
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send('No code provided');
    }

    try {
        // Обмениваем code на access_token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

        const access_token = tokenResponse.data.access_token;

        // Получаем данные пользователя
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const user = userResponse.data;

        // Сохраняем пользователя в сессии
        req.session.user = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar,
            email: user.email,
            global_name: user.global_name
        };

        // Перенаправляем обратно на главную страницу
        res.redirect('/');
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// 3. Выход
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// 4. API для проверки авторизации (фронтенд будет спрашивать)
app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Запускаем сервер
app.listen(process.env.PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${process.env.PORT}`);
});