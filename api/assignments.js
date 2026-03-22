app.get('/api/data', async (req, res) => {
    if (!req.session.token) return res.status(401).json({ error: "Not logged in" });

    try {
        const headers = { Authorization: `Bearer ${req.session.token}` };
        
        const [profile, courses, planner] = await Promise.all([
            axios.get(`${CANVAS_URL}/api/v1/users/self`, { headers }),
            axios.get(`${CANVAS_URL}/api/v1/courses?include[]=enrollments&per_page=50`, { headers }),
            axios.get(`${CANVAS_URL}/api/v1/planner/items`, { headers })
        ]);

        // Fix duplicates: Use a Map to filter courses by ID
        const uniqueCourses = Array.from(
            new Map(courses.data.filter(c => c.name).map(c => [c.id, c])).values()
        );

        res.json({
            user: profile.data.short_name || profile.data.name,
            courses: uniqueCourses,
            planner: planner.data
        });
    } catch (error) {
        console.error("Fetch Error:", error.message);
        res.status(500).json({ error: "Failed to fetch data" });
    }
});
