// 1. THE BRIDGE: Detect environment
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

// 2. STATE
let username = '';
let currentRoom = 'general';
let availableRooms = [];

// 3. UI INITIALIZATION
function initializeApp() {
    const loginBtn = document.getElementById('loginBtn');
    const usernameInput = document.getElementById('usernameInput');
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const roomsDiv = document.getElementById('rooms');
    const messagesDiv = document.getElementById('messages');
    const newRoomControls = document.getElementById('newRoomControls');
    const newRoomInput = document.getElementById('newRoomInput');

    // --- Browser-only WebSocket Logic ---
    if (!isElectron) {
        function connectBrowser() {
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            browserSocket = new WebSocket(`${protocol}://${window.location.host}`);
            browserSocket.onopen = () => window.onStatusChange?.('Connected');
            browserSocket.onclose = () => {
                window.onStatusChange?.('Disconnected');
                setTimeout(connectBrowser, 3000);
            };
            browserSocket.onmessage = (event) => window.onChatMsg?.(JSON.parse(event.data));
        }
        connectBrowser();
    }

    // --- UI Logic ---
    function login() {
        username = usernameInput.value.trim();
        if (username) {
            document.getElementById('loginOverlay').style.display = 'none';
            chat.sendMessage({ type: 'identify', username });
            chat.sendMessage({ type: 'get-rooms' });
        }
    }

    loginBtn.onclick = login;
    usernameInput.onkeydown = (e) => { if (e.key === 'Enter') login(); };

    sendBtn.onclick = () => {
        const content = messageInput.value.trim();
        if (content) {
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

    // --- Response Handling ---
    chat.onStatus((status) => {
        document.getElementById('statusText').textContent = `Status: ${status}`;
    });

    chat.onMessage((msg) => {
        if (msg.type === 'room-list') {
            availableRooms = msg.rooms;
            renderRoomList();
        } else if (msg.type === 'chat' && msg.room === currentRoom) {
            displayMessage(msg);
        } else if (msg.type === 'history') {
            messagesDiv.innerHTML = '';
            msg.messages.forEach(displayMessage);
        } else if (msg.type === 'user-list') {
            renderUserList(msg.users);
        }
    });

    function displayMessage(msg) {
        const div = document.createElement('div');
        div.className = 'message';
        div.innerHTML = `<strong>${msg.username}</strong>: ${msg.content}`;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function renderRoomList() {
        roomsDiv.innerHTML = '<div id="newRoomControls" style="display:none"><input id="newRoomInput"><button id="confirmRoomBtn">OK</button></div><h3>Rooms <button id="addRoomBtn">+</button></h3>';
        availableRooms.forEach(room => {
            const btn = document.createElement('button');
            btn.textContent = `# ${room}`;
            btn.className = room === currentRoom ? 'active' : '';
            btn.onclick = () => {
                currentRoom = room;
                chat.sendMessage({ type: 'join-room', room });
                renderRoomList();
            };
            roomsDiv.appendChild(btn);
        });
        document.getElementById('addRoomBtn').onclick = () => document.getElementById('newRoomControls').style.display = 'block';
    }

    function renderUserList(users) {
        const list = document.getElementById('userList');
        list.innerHTML = '';
        document.getElementById('userCount').textContent = users.length;
        users.forEach(u => {
            const d = document.createElement('div');
            d.textContent = u;
            list.appendChild(d);
        });
    }
}

// 4. WAIT FOR DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}