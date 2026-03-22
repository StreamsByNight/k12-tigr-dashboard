const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const app = express();

// --- CONFIGURATION ---
const CANVAS_BASE = process.env.CANVAS_URL || "stridek12academy.com";
const CANVAS_URL = CANVAS_BASE.startsWith('http') ? CANVAS_BASE : `https://${CANVAS_BASE}`;

// These are your Canvas Developer Key credentials
const CLIENT_ID = process.env.CLIENT_ID || "10000000000031";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "8ZayHAKETAUn3mUWE3PQtD9ZmNZYZ4mDhfFnfcTP8V6HeBHTCfVzVa6znJmUUxuD";

// Your new custom domain
const BASE_URL = process.env.REDIRECT_URI || "https://launchpad.k12learning.online";
const REDIRECT_URI = BASE_URL.includes('/api/auth/callback') ? BASE_URL : `${BASE_URL.replace(/\/$/, "")}/api/auth/callback`;

const PORT = process.env.PORT || 3000;

// --- ADMIN SETTINGS ---
// IMPORTANT: Put your actual Canvas User ID in this array to gain access to /admin
const ADMIN_IDS = ['YOUR_CANVAS_ID_HERE', '10000000000031']; 

app.set('trust proxy', 1);

app.use(session({
    secret: 'tigr-secret-key-12345', // Change this to a random string for better security
    resave: true,                
    saveUninitialized: false, 
    cookie: { 
        secure: true, // Required for HTTPS domains           
        sameSite: 'none',        
        maxAge: 1000 * 60 * 60 * 24 // Session lasts 24 hours
    } 
}));

app.use(express.static('public')); 

// --- HELPER: Extract School Initials (e.g., "CVA" from "CVA_Algebra") ---
const extractInitials = (courseCode) => {
    try {
        if (!courseCode) return "K12";
        // Split by underscores or dashes and take the first part
        const parts = courseCode.split(/[_-]/); 
        const firstPart = parts[0].toUpperCase();
        // If the first part is too long, it's probably not an initial, so trim it
        return firstPart.length <= 5 ? firstPart : firstPart.substring(0, 3);
    } catch (e) {
        return "K12";
    }
};

// 1. Start Login Handshake
app.get('/api/auth/canvas', (req, res) => {
    const authUrl = `${CANVAS_URL}/login/oauth2/auth?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    console.log("Redirecting to Canvas Auth...");
    res.redirect(authUrl);
});

// 2. Auth Callback (Canvas sends the user back here)
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided from Canvas.");

    try {
        const response = await axios.post(`${CANVAS_URL}/login/oauth2/token`, {
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            code: code
        });
        
        req.session.token = response.data.access_token;
        // This is used for the Admin check
        req.session.canvas_user_id = response.data.user.id.toString();
        
        req.session.save((err) => {
            if (err) return res.status(500).send("Session Save Error");
            res.redirect('/'); 
        });
    } catch (error) {
        console.error("TOKEN EXCHANGE ERROR:", error.response?.data || error.message);
        res.status(500).send("Login failed. Check your Developer Key Secret.");
    }
});

// 3. Protected Admin Route
app.get('/admin', (req, res) => {
    // Only allow if logged in AND ID is in the ADMIN_IDS list
    if (!req.session.token || !ADMIN_IDS.includes(req.session.canvas_user_id)) {
        return res.status(403).send("<h1>403 Forbidden</h1><p>You do not have permission to access the control panel.</p>");
    }
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// 4. Main Data Fetching Route
app.get('/api/assignments', async (req, res) => {
    if (!req.session.token) {
        return res.status(401).json({ error: "Not logged in" });
    }

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

        // Remove duplicate course entries
        const uniqueCourses = Array.from(
            new Map(processedCourses.map(course => [course.id, course])).values()
        );

        // Determine the "Main School" for the header badge
        const mainSchool = uniqueCourses.length > 0 ? uniqueCourses[0].school_initial : "K12";

        res.json({
            user: profile.data.short_name || profile.data.name, 
            courses: uniqueCourses,                             
            planner: planner.data,
            main_school: mainSchool 
        });
    } catch (error) {
        if (error.response?.status === 401) {
            req.session.token = null;
            return res.status(401).json({ error: "Session expired" });
        }
        res.status(500).json({ error: "Failed to fetch Canvas data" });
    }
});

// 5. Logout Route
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid'); 
    res.redirect('/');
});

app.listen(PORT, () => console.log(`Dashboard live at port ${PORT}. Domain: ${REDIRECT_URI}`));
