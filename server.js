const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const app = express();

// --- CONFIGURATION ---
const CANVAS_BASE = process.env.CANVAS_URL || "stridek12academy.com";
const CANVAS_URL = CANVAS_BASE.startsWith('http') ? CANVAS_BASE : `https://${CANVAS_BASE}`;

// Note: Ensure these match your Canvas Developer Key settings
const CLIENT_ID = process.env.CLIENT_ID || "10000000000031";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "8ZayHAKETAUn3mUWE3PQtD9ZmNZYZ4mDhfFnfcTP8V6HeBHTCfVzVa6znJmUUxuD";

const BASE_URL = process.env.REDIRECT_URI || "https://launchpad.k12learning.online";
const REDIRECT_URI = BASE_URL.includes('/api/auth/callback') ? BASE_URL : `${BASE_URL.replace(/\/$/, "")}/api/auth/callback`;

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

// --- ADMIN & MAINTENANCE SETTINGS ---
const ADMIN_IDS = ['1', '10000000000031']; 
let isMaintenanceMode = false;

// --- DATABASE PERSISTENCE ---
let schoolOverrides = {}; 
let systemAnnouncement = "";

// Initialize/Load Database
if (fs.existsSync(DB_PATH)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        schoolOverrides = data.overrides || {};
        systemAnnouncement = data.announcement || "";
        console.log("Database loaded.");
    } catch (e) {
        console.error("Database error, starting fresh.");
    }
}

const saveToDb = () => {
    const dataToSave = { overrides: schoolOverrides, announcement: systemAnnouncement };
    fs.writeFileSync(DB_PATH, JSON.stringify(dataToSave, null, 2));
};

// --- MIDDLEWARE ---
app.set('trust proxy', 1);
app.use(session({
    secret: 'stride-launchpad-secret',
    resave: true,
    saveUninitialized: false,
    cookie: { secure: true, sameSite: 'none', maxAge: 1000 * 60 * 60 * 24 }
}));
app.use(express.static('public'));
app.use(express.json());

// --- UTILS ---
const extractInitials = (courseCode) => {
    if (!courseCode) return "K12";
    const parts = courseCode.split(/[_-]/);
    const firstPart = parts[0].toUpperCase();
    return firstPart.length <= 5 ? firstPart : firstPart.substring(0, 3);
};

// --- AUTH ROUTES ---
app.get('/api/auth/canvas', (req, res) => {
    const authUrl = `${CANVAS_URL}/login/oauth2/auth?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.redirect(authUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided.");
    try {
        const response = await axios.post(`${CANVAS_URL}/login/oauth2/token`, {
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            code: code
        });
        req.session.token = response.data.access_token;
        req.session.canvas_user_id = response.data.user.id.toString();
        req.session.user_name = response.data.user.name;
        req.session.save(() => res.redirect('/'));
    } catch (error) {
        res.status(500).send("Login failed.");
    }
});

// --- STRIDE MANIFEST COMPATIBILITY ROUTES ---

// 1. Official Profile Route
app.get('/api/profile', (req, res) => {
    if (!req.session.token) return res.status(401).json({ error: "Unauthorized" });
    res.json({
        id: req.session.canvas_user_id,
        name: req.session.user_name,
        role: ADMIN_IDS.includes(req.session.canvas_user_id) ? "admin" : "student"
    });
});

// 2. Official School Profile (For SchoolPill-CN)
app.get('/api/schoolProfile', (req, res) => {
    const userId = req.session.canvas_user_id || "guest";
    const manual = schoolOverrides[userId];
    res.json({
        schoolName: "Stride K12 Academy",
        schoolInitial: manual || "K12",
        displayPill: true
    });
});

// --- ADMIN API ---
app.get('/admin', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.status(403).send("Forbidden");
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.post('/api/admin/announcement', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    systemAnnouncement = req.body.message || "";
    saveToDb();
    res.json({ success: true });
});

app.post('/api/admin/overrides', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    const { userId, initial } = req.body;
    schoolOverrides[userId.toString()] = initial.toUpperCase().substring(0, 5);
    saveToDb();
    res.json({ success: true });
});

// --- DATA FETCHING ---
app.get('/api/assignments', async (req, res) => {
    const userId = req.session.canvas_user_id;
    if (isMaintenanceMode && !ADMIN_IDS.includes(userId)) return res.status(503).json({ error: "Maintenance" });
    if (!req.session.token) return res.status(401).json({ error: "Not logged in" });

    try {
        const headers = { Authorization: `Bearer ${req.session.token}` };
        const [coursesRes, plannerRes] = await Promise.all([
            axios.get(`${CANVAS_URL}/api/v1/courses?include[]=enrollments&per_page=50`, { headers }),
            axios.get(`${CANVAS_URL}/api/v1/planner/items`, { headers })
        ]);

        const courses = coursesRes.data.filter(c => c.name).map(c => ({
            ...c,
            school_initial: extractInitials(c.course_code || c.name)
        }));

        res.json({
            user: req.session.user_name,
            userId: userId,
            courses: courses,
            planner: plannerRes.data,
            main_school: schoolOverrides[userId] || (courses[0]?.school_initial || "K12"),
            announcement: systemAnnouncement,
            isAdmin: ADMIN_IDS.includes(userId)
        });
    } catch (error) {
        res.status(500).json({ error: "Data fetch failed" });
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid').redirect('/');
});

app.listen(PORT, () => console.log(`Stride Launchpad Server active on port ${PORT}`));
