
let selectedAction = '';
let countdown = 15;
let timerInterval;

function openModal() {
    document.getElementById('powerModal').style.display = 'block';
}
function closeModal() {
    clearInterval(timerInterval);
    document.getElementById('confirmSection').style.display = 'none';
    document.getElementById('powerModal').style.display = 'none';
}

function confirmAction(action) {
    selectedAction = action;
    document.getElementById('confirmText').innerText = `Are you sure you want to ${action}?`;
    document.getElementById('countdown').innerHTML = `System will automatically ${action} in <span id="timer">15</span> seconds`;
    document.getElementById('confirmSection').style.display = 'block';
    countdown = 15;
    timerInterval = setInterval(updateTimer, 1000);
}

function cancelConfirm() {
    clearInterval(timerInterval);
    document.getElementById('confirmSection').style.display = 'none';
}

function updateTimer() {
    countdown--;
    document.getElementById('timer').innerText = countdown;
    if (countdown <= 0) {
        clearInterval(timerInterval);
        executeAction();
    }
}

function executeAction() {
    let url = '';
    switch (selectedAction) {
        case 'shutdown':
            url = '/shutdown';
            break;
        case 'reboot':
            url = '/reboot';
            break;
        case 'force shutdown':
            url = '/force-shutdown';
            break;
    }

    fetch(url, { method: 'POST' })
        .then(() => {
            document.getElementById('confirmText').innerText = `Executing ${selectedAction}...`;
        })
        .catch(() => {
            document.getElementById('confirmText').innerText = `Failed to ${selectedAction}`;
        });

    clearInterval(timerInterval);
}

function startEtherCAT() {
    fetch('http://localhost:3000/driver/start-ethercat', {
        method: 'POST'
    })
        .then(res => res.text())
        .then(data => {
            document.getElementById('output').textContent = "Started";
        })
        .catch(err => {
            document.getElementById('output').textContent = `Error`;
        });
}

function controlService(service, action) {
    fetch(`/${action}/${service}`, { method: 'POST' })
        .then(res => res.text())
        .then(msg => alert(msg))
        .catch(err => alert('Error: ' + err));
}





