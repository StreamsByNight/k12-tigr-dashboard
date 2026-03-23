const API = {
    async getAssignments() {
        const res = await fetch('/api/assignments');
        return res.json();
    },
    async getLiveSessions() {
        const res = await fetch('/api/classconnect');
        return res.json();
    },
    async getSchoolProfile() {
        const res = await fetch('/api/schoolProfile');
        return res.json();
    }
};
export default API;
