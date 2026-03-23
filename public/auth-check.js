(async function checkAuth() {
    try {
        const response = await fetch('/api/profile');
        if (response.status === 401) {
            // Not logged in? Send them to the Canvas Auth route immediately
            window.location.href = '/api/auth/canvas';
        }
    } catch (err) {
        console.error("Auth check failed", err);
    }
})();
