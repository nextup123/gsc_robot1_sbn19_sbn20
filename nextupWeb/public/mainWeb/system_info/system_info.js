function updateSystemStatus() {
    // Update current time (client-side)
    const now = new Date();
    document.getElementById('sys-status-current-time').textContent = 
        `TIME : ${now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}`;

    // Fetch server uptime info
    fetch('/uptime')
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(data => {
            document.getElementById('sys-status-uptime').textContent = `UpTime: ${data.uptime}`;
            document.getElementById('sys-status-load-avg').textContent = 
                `Load: ${data.loadAverage.replace(/,/g, ' ')}`;
        })
        .catch(error => {
            console.error('System status error:', error);
            document.getElementById('sys-status-load-avg').textContent = 'Load: N/A';
        });
}

// Initial call and set interval for 1Hz updates
updateSystemStatus();
setInterval(updateSystemStatus, 1000);