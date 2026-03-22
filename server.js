const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const app = express();

// --- CONFIGURATION ---
const CANVAS_BASE = process.env.CANVAS_URL || "stridek12academy.com";
const CANVAS_URL = CANVAS_BASE.startsWith('http') ? CANVAS_BASE : `https://${CANVAS_BASE}`;

const CLIENT_ID = process.env.CLIENT_ID || "10000000000031";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "8ZayHAKETAUn3mUWE3PQtD9ZmNZYZ4mDhfFnfcTP8V6HeBHTCfVzVa6znJmUUxuD";

const BASE_URL = process.env.REDIRECT_URI || "https://launchpad.k12learning.online";
const REDIRECT_URI = BASE_URL.includes('/api/auth/callback') ? BASE_URL : `${BASE_URL.replace(/\/$/, "")}/api/auth/callback`;

const PORT = process.env.PORT || 3000;

// --- ADMIN & MAINTENANCE SETTINGS ---
// Added '1' so User ID 1 always has perms as requested
const ADMIN_IDS = ['1', 'YOUR_CANVAS_ID_HERE', '10000000000031']; 
let isMaintenanceMode = false;

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

// 1. Start Login
app.get('/api/auth/canvas', (req, res) => {
    const authUrl = `${CANVAS_URL}/login/oauth2/auth?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.redirect(authUrl);
});

// 2. Auth Callback
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

// 3. Admin Routes
app.get('/admin', (req, res) => {
    if (!req.session.token || !ADMIN_IDS.includes(req.session.canvas_user_id)) {
        return res.status(403).send("<h1>403 Forbidden</h1><p>Admin privileges required.</p>");
    }
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Toggle Maintenance Mode
app.post('/api/admin/maintenance', (req, res) => {
    if (!ADMIN_IDS.includes(req.session.canvas_user_id)) return res.sendStatus(403);
    isMaintenanceMode = !isMaintenanceMode;
    console.log(`Maintenance Mode is now: ${isMaintenanceMode}`);
    res.json({ enabled: isMaintenanceMode });
});

// 4. Main Data Route (With Maintenance Check)
app.get('/api/assignments', async (req, res) => {
    const userId = req.session.canvas_user_id;

    // Maintenance Logic: Block non-admins if maintenance is active
    if (isMaintenanceMode && !ADMIN_IDS.includes(userId)) {
        return res.status(503).json({ 
            error: "Maintenance Mode", 
            message: "The Launchpad is currently under maintenance. Please try again later." 
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
        const mainSchool = uniqueCourses.length > 0 ? uniqueCourses[0].school_initial : "K12";

        res.json({
            user: profile.data.short_name || profile.data.name, 
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

// 5. Logout
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid').redirect('/');
});

app.listen(PORT, () => console.log(`Server live on ${PORT}`));
