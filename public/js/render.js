export function renderLiveSession(session) {
    const container = document.getElementById('live-schedule-container');
    if (!session || session.length === 0) {
        container.innerHTML = '<p class="text-gray-400">No events today.</p>';
        return;
    }
    
    const card = `
        <div class="bg-blue-700 p-4 rounded-lg flex justify-between items-center shadow-md">
            <div>
                <h3 class="font-bold">${session[0].name}</h3>
                <p class="text-sm text-blue-200">${session[0].instructorName}</p>
            </div>
            <a href="${session[0].meetingUrl}" target="_blank" 
               class="bg-white text-blue-700 px-4 py-2 rounded-full font-bold hover:bg-blue-50 transition">
               JOIN
            </a>
        </div>
    `;
    container.innerHTML = card;
}
