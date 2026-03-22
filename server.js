const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const fs = require('fs'); // Added for persistent storage
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

// --- ADMIN & MAINTENANCE SETTINGS ---
const ADMIN_IDS = ['1', '10000000000031']; 
let isMaintenanceMode = false;

// --- DATABASE PERSISTENCE ---
let schoolOverrides = {};

// Load existing data on startup
if (fs.existsSync(DB_PATH)) {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        schoolOverrides = JSON.parse(data);
        console.log("Database loaded successfully.");
    } catch (e) {
        console.error("Error parsing database.json, starting empty.");
    }
}

// Helper to save changes to file
const saveToDb = () => {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(schoolOverrides, null, 2));
    } catch (e) {
        console.error("Failed to save to database.json", e);
    }
};

app.set('trust proxy', 1);

app.use(session({
    secret: 'tigr-secret-key-12345', 
    resave: true,                
    saveUninitialized: false, 
    cookie: { 
        secure: true,            
        sameSite: 'none',        
        maxAge: 1000 * 60 * 60 * 24 
    } 
}));

app.use(express.static('public')); 
app.use(express.json()); 

// --- HELPER: Extract School Initials ---
const extractInitials = (courseCode) => {
    try {
        if (!courseCode) return "K12";
        const parts = courseCode.split(/[_-]/); 
        const firstPart = parts[0].toUpperCase();
        return firstPart.length <= 5 ? firstPart : firstPart.substring(0, 3);
    } catch (e) {
        return "K12";
    }
};

// 1. Auth Routes
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
        
        req.session.save((err) => {
            if (err) return res.status(500).send("Session Save Error");
            res.redirect('/'); 
        });
    } catch (error) {
        res.status(500).send("Login failed.");
    }
});

// 2. Admin Panel & Override Routes
app.get('/admin', (req, res) => {
    if (!req.session.token || !ADMIN_IDS.includes(req.session.canvas_user_id)) {
        return res.status(403).send("<h1>403 Forbidden</h1><p>Admin privileges required.</p>");
    }
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Toggle Maintenance
app.post('/api/admin/maintenance', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    isMaintenanceMode = !isMaintenanceMode;
    res.json({ enabled: isMaintenanceMode });
});

// Set Manual School Initial Override (Persistent)
app.post('/api/admin/overrides', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    const { userId, initial } = req.body;
    
    if (userId && initial) {
        schoolOverrides[userId.toString()] = initial.toUpperCase().substring(0, 5);
        saveToDb(); // Write to JSON file
        res.json({ success: true, overrides: schoolOverrides });
    } else {
        res.status(400).json({ error: "UserID and Initial required" });
    }
});

// Delete an Override
app.delete('/api/admin/overrides/:userId', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    const { userId } = req.params;
    
    if (schoolOverrides[userId]) {
        delete schoolOverrides[userId];
        saveToDb(); // Sync change to file
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Override not found" });
    }
});

// Get current overrides list
app.get('/api/admin/overrides', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    res.json(schoolOverrides);
});

// 3. Main Data Route
app.get('/api/assignments', async (req, res) => {
    const userId = req.session.canvas_user_id;

    if (isMaintenanceMode && !ADMIN_IDS.includes(userId)) {
        return res.status(503).json({ 
            error: "Maintenance Mode", 
            message: "Under construction. Back soon!" 
        });
    }

    if (!req.session.token) return res.status(401).json({ error: "Not logged in" });

    try {
        const headers = { Authorization: `Bearer ${req.session.token}` };
        
        const [profile, coursesResponse, planner] = await Promise.all([
            axios.get(`${CANVAS_URL}/api/v1/users/self`, { headers }),
            axios.get(`${CANVAS_URL}/api/v1/courses?include[]=enrollments&per_page=50`, { headers }),
            axios.get(`${CANVAS_URL}/api/v1/planner/items`, { headers })
        ]);

        const processedCourses = coursesResponse.data
            .filter(c => c.name)
            .map(course => ({
                ...course,
                school_initial: extractInitials(course.course_code || course.name)
            }));

        const uniqueCourses = Array.from(new Map(processedCourses.map(c => [c.id, c])).values());
        
        // Priority: 1. Manual Override (Persistent) | 2. Auto-detected | 3. Default
        const manualInitial = schoolOverrides[userId];
        const mainSchool = manualInitial || (uniqueCourses.length > 0 ? uniqueCourses[0].school_initial : "K12");

        res.json({
            user: profile.data.short_name || profile.data.name, 
            userId: userId, 
            courses: uniqueCourses,                               
            planner: planner.data,
            main_school: mainSchool,
            isAdmin: ADMIN_IDS.includes(userId) 
        });
    } catch (error) {
        if (error.response?.status === 401) req.session.token = null;
        res.status(500).json({ error: "Failed to fetch data" });
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid').redirect('/');
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
