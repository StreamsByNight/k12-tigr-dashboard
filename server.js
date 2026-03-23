const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const app = express();

// --- CONFIGURATION ---
const CANVAS_BASE = process.env.CANVAS_URL || "stridek12academy.com";
const CANVAS_URL = CANVAS_BASE.startsWith('http') ? CANVAS_BASE : `https://${CANVAS_BASE}`;
const CLIENT_ID = process.env.CLIENT_ID || "10000000000031";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "8ZayHAKETAUn3mUWE3PQtD9ZmNZYZ4mDhfFnfcTP8V6HeBHTCfVzVa6znJmUUxuD";
const BASE_URL = process.env.REDIRECT_URI || "https://launchpad.k12learning.online";
const REDIRECT_URI = BASE_URL.includes('/api/auth/callback') ? BASE_URL : `${BASE_URL.replace(/\/$/, "")}/api/auth/callback`;
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

// --- DATABASE & ADMIN ---
const ADMIN_IDS = ['1', '10000000000031'];
let schoolOverrides = {};
let systemAnnouncement = "";

if (fs.existsSync(DB_PATH)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        schoolOverrides = data.overrides || {};
        systemAnnouncement = data.announcement || "";
        console.log("Database loaded.");
    } catch (e) { console.error("DB Load Error, starting fresh."); }
}

const saveToDb = () => {
    fs.writeFileSync(DB_PATH, JSON.stringify({ overrides: schoolOverrides, announcement: systemAnnouncement }, null, 2));
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

// --- LIVE SESSION ENGINE ---
const getMockSessions = () => {
    const now = new Date();
    // Set start to 10 minutes ago and end to 50 minutes from now to ensure it's "Live"
    const start = new Date(now.getTime() - (10 * 60 * 1000)); 
    const end = new Date(now.getTime() + (50 * 60 * 1000));  
    
    return [{
        id: "session-999",
        name: "Morning Homeroom - LIVE",
        instructorName: "Stride Instructor",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        meetingUrl: "https://google.com", 
        isLive: true,
        status: "active",
        canJoin: true,
        isRequired: true,
        timeZone: "UTC"
    }];
};

// --- ROUTES ---

// 1. Live Schedule & Calendar Coverage
app.get(['/api/classconnect', '/api/coach/classconnect'], (req, res) => res.json(getMockSessions()));
app.get(['/api/canvas/events', '/api/coach/events'], (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    res.json([{
        id: "ev-1",
        title: "Live Class Session",
        start_at: `${today}T12:00:00Z`,
        type: "calendar_event",
        workflow_state: "active"
    }]);
});

// 2. Profile & School Pill
app.get('/api/profile', (req, res) => {
    if (!req.session.token) return res.status(401).json({ error: "Unauthorized" });
    res.json({ id: req.session.canvas_user_id, name: req.session.user_name });
});

app.get('/api/schoolProfile', (req, res) => {
    const initial = schoolOverrides[req.session.canvas_user_id] || "K12";
    res.json({ schoolName: "Stride Academy", schoolInitial: initial, displayPill: true });
});

// 3. Admin Functionality
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

app.get('/api/admin/overrides', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    res.json(schoolOverrides);
});

// 4. Main Data Route
app.get('/api/assignments', async (req, res) => {
    if (!req.session.token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const headers = { Authorization: `Bearer ${req.session.token}` };
        const [coursesRes, plannerRes] = await Promise.all([
            axios.get(`${CANVAS_URL}/api/v1/courses?include[]=enrollments&per_page=50`, { headers }),
            axios.get(`${CANVAS_URL}/api/v1/planner/items`, { headers })
        ]);
        res.json({
            user: req.session.user_name,
            userId: req.session.canvas_user_id,
            courses: coursesRes.data.filter(c => c.name),
            planner: plannerRes.data,
            announcement: systemAnnouncement,
            isAdmin: ADMIN_IDS.includes(req.session.canvas_user_id)
        });
    } catch (e) { res.status(500).json({ error: "Data fetch failed" }); }
});

// 5. Auth Logic
app.get('/api/auth/canvas', (req, res) => {
    res.redirect(`${CANVAS_URL}/login/oauth2/auth?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`);
});

app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const response = await axios.post(`${CANVAS_URL}/login/oauth2/token`, {
            grant_type: 'authorization_code', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, code
        });
        req.session.token = response.data.access_token;
        req.session.canvas_user_id = response.data.user.id.toString();
        req.session.user_name = response.data.user.name;
        req.session.save(() => res.redirect('/'));
    } catch (error) { res.status(500).send("Login failed."); }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid').redirect('/');
});

app.listen(PORT, () => console.log(`Stride Launchpad Server active on port ${PORT}`));
