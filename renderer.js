// ----------------------------------------------------------------
// 1. THE BRIDGE: Handle Electron vs. Browser 
// ----------------------------------------------------------------
const isElectron = navigator.userAgent.toLowerCase().includes('electron');
let browserSocket;

const chat = isElectron ? window.chatAPI : {
    sendMessage: (msg) => {
        if (browserSocket && browserSocket.readyState === 1) {
            browserSocket.send(JSON.stringify(msg));
        }
    },
    onMessage: (callback) => { window.onChatMsg = callback; },
    onStatus: (callback) => { window.onStatusChange = callback; }
};

// Browser-specific connection logic (only runs if NOT in Electron)
if (!isElectron) {
    function connectBrowser() {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        browserSocket = new WebSocket(`${protocol}://${window.location.host}`);

        browserSocket.onopen = () => window.onStatusChange?.('Connected');
        browserSocket.onclose = () => {
            window.onStatusChange?.('Disconnected');
            setTimeout(connectBrowser, 3000); // Auto-reconnect
        };
        browserSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            window.onChatMsg?.(data);
        };
    }
    connectBrowser();
}

// ----------------------------------------------------------------
// 2. STATE & UI ELEMENTS
// ----------------------------------------------------------------
let username = '';
let currentRoom = 'general';
let availableRooms = [];

const loginOverlay = document.getElementById('loginOverlay');
const usernameInput = document.getElementById('usernameInput');
const loginBtn = document.getElementById('loginBtn');
const statusText = document.getElementById('statusText');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const roomsDiv = document.getElementById('rooms');
const userListDiv = document.getElementById('userList');
const userCountSpan = document.getElementById('userCount');

// Add Room Controls
const newRoomControls = document.getElementById('newRoomControls');
const newRoomInput = document.getElementById('newRoomInput');
const confirmRoomBtn = document.getElementById('confirmRoomBtn');
const cancelRoomBtn = document.getElementById('cancelRoomBtn');

// ----------------------------------------------------------------
// 3. CORE FUNCTIONS
// ----------------------------------------------------------------

function login() {
    username = usernameInput.value.trim();
    if (username) {
        loginOverlay.style.display = 'none';
        chat.sendMessage({ type: 'identify', username });
        chat.sendMessage({ type: 'get-rooms' });
    }
}

function switchRoom(roomName) {
    currentRoom = roomName;
    messagesDiv.innerHTML = ''; // Clear for new history
    chat.sendMessage({ type: 'join-room', room: roomName });
    renderRoomList();
}

function renderRoomList() {
    // Keep the hidden controls in the DOM
    const controls = document.getElementById('newRoomControls');
    roomsDiv.innerHTML = '';
    roomsDiv.appendChild(controls);

    const header = document.createElement('h3');
    header.textContent = 'Rooms';
    
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.onclick = () => {
        newRoomControls.style.display = 'block';
        newRoomInput.focus();
    };
    
    header.appendChild(addBtn);
    roomsDiv.appendChild(header);

    availableRooms.forEach(room => {
        const btn = document.createElement('button');
        btn.textContent = `# ${room}`;
        btn.className = `room-btn ${room === currentRoom ? 'active' : ''}`;
        btn.onclick = () => switchRoom(room);
        roomsDiv.appendChild(btn);
    });
}

function renderUserList(users) {
    userListDiv.innerHTML = '';
    userCountSpan.textContent = users.length;
    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.textContent = u === username ? `${u} (You)` : u;
        userListDiv.appendChild(div);
    });
}

function displayMessage(msg) {
    const div = document.createElement('div');
    div.className = 'message';
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<strong>${msg.username}</strong> <span class="timestamp">${time}</span><br>${msg.content}`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ----------------------------------------------------------------
// 4. EVENT LISTENERS
// ----------------------------------------------------------------

loginBtn.onclick = login;
usernameInput.onkeydown = (e) => { if (e.key === 'Enter') login(); };

sendBtn.onclick = () => {
    const content = messageInput.value.trim();
    if (content && currentRoom) {
        chat.sendMessage({
            type: 'chat',
            id: crypto.randomUUID(),
            room: currentRoom,
            username: username,
            content: content,
            timestamp: new Date().toISOString()
        });
        messageInput.value = '';
    }
};

messageInput.onkeydown = (e) => { if (e.key === 'Enter') sendBtn.click(); };

// Room Creator Listeners
confirmRoomBtn.onclick = () => {
    const name = newRoomInput.value.trim();
    if (name) {
        const sanitized = name.toLowerCase().replace(/\s+/g, '-');
        chat.sendMessage({ type: 'create-room', room: sanitized });
        newRoomInput.value = '';
        newRoomControls.style.display = 'none';
    }
};

cancelRoomBtn.onclick = () => {
    newRoomInput.value = '';
    newRoomControls.style.display = 'none';
};

// ----------------------------------------------------------------
// 5. INCOMING DATA HANDLER
// ----------------------------------------------------------------

chat.onStatus((status) => {
    statusText.textContent = `Status: ${status}`;
});

chat.onMessage((msg) => {
    switch (msg.type) {
        case 'room-list':
            availableRooms = msg.rooms;
            renderRoomList();
            break;
        case 'user-list':
            renderUserList(msg.users);
            break;
        case 'history':
            messagesDiv.innerHTML = '';
            msg.messages.forEach(displayMessage);
            break;
        case 'chat':
            if (msg.room === currentRoom) {
                displayMessage(msg);
            }
            break;
    }
});