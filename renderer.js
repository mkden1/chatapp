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

// 2. STATE (Restored original state variables)
let username = null;
let currentRoom = null;
let availableRooms = [];
const messageElements = new Map(); 
let pendingMessages = []; 
let isIdentified = false;

// 3. UI INITIALIZATION
function initializeApp() {
    // Get all elements by ID
    const messagesDiv = document.getElementById('messages');
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const statusSpan = document.getElementById('statusText'); // Matches your HTML
    const usernameInput = document.getElementById('usernameInput');
    const loginBtn = document.getElementById('loginBtn'); // Matches your HTML
    const roomsDiv = document.getElementById('rooms');
    const newRoomControls = document.getElementById('newRoomControls');
    const newRoomInput = document.getElementById('newRoomInput');
    const confirmRoomBtn = document.getElementById('confirmRoomBtn');
    const cancelRoomBtn = document.getElementById('cancelRoomBtn');
    const userListDiv = document.getElementById('userList');
    const userCountSpan = document.getElementById('userCount');

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

    // --- RESTORED ORIGINAL UI HELPERS ---
    function addMessage(msg, isPending = false) {
        if (messageElements.has(msg.id) && !isPending) return;

        const wrapper = document.createElement('div');
        wrapper.className = `message ${msg.username === username ? 'own' : 'other'}`;
        
        const timeString = new Date(msg.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', minute: '2-digit' 
        });

        wrapper.innerHTML = `
            <div class="meta">${msg.username}</div>
            <div class="content">${msg.content}</div>
            <span class="hover-timestamp">${timeString}</span>
        `;

        if (msg.username === username) {
            const statusDiv = document.createElement('div');
            statusDiv.className = 'status';
            statusDiv.textContent = isPending ? 'pending' : '';
            wrapper.appendChild(statusDiv);
            messageElements.set(msg.id, statusDiv);
        }

        messagesDiv.appendChild(wrapper);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function renderRoomList() {
        roomsDiv.innerHTML = '';
        roomsDiv.appendChild(newRoomControls); 

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

    function switchRoom(roomName) {
        if (roomName === currentRoom) return;
        currentRoom = roomName;
        messagesDiv.innerHTML = '';
        messageElements.clear();
        chat.sendMessage({ type: 'join-room', room: currentRoom });
        renderRoomList();
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

    // --- RESTORED EVENT LISTENERS ---
    loginBtn.onclick = () => {
        const name = usernameInput.value.trim();
        if (!name) return;
        username = name;
        document.getElementById('loginOverlay').style.display = 'none';
        chat.sendMessage({ type: 'identify', username });
    };

    sendBtn.onclick = () => {
        const content = input.value.trim();
        if (!content || !currentRoom) return;
        const msgId = crypto.randomUUID();
        const msgData = { 
            type: 'chat', id: msgId, room: currentRoom, 
            username, content, timestamp: Date.now() 
        };
        addMessage(msgData, true);
        pendingMessages.push(msgData);
        chat.sendMessage(msgData);
        input.value = '';
    };

    input.onkeydown = (e) => { if (e.key === 'Enter') sendBtn.click(); };

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

    // --- RESTORED MESSAGE HANDLING ---
    chat.onStatus(status => {
        statusSpan.textContent = status;
        statusSpan.style.color = status === 'Connected' ? '#43b581' : '#f04747';
        if (status === 'Connected' && username) {
            isIdentified = false;
            chat.sendMessage({ type: 'identify', username });
        }
    });

    chat.onMessage((msg) => {
        switch (msg.type) {
            case 'identified':
                isIdentified = true;
                chat.sendMessage({ type: 'get-rooms' });
                if (currentRoom) chat.sendMessage({ type: 'join-room', room: currentRoom });
                break;
            case 'room-list':
                availableRooms = msg.rooms;
                if (!currentRoom && availableRooms.length > 0) switchRoom(availableRooms[0]);
                renderRoomList();
                break;
            case 'history':
                messagesDiv.innerHTML = '';
                messageElements.clear();
                msg.messages.forEach(m => addMessage(m, false));
                const historyIds = new Set(msg.messages.map(m => m.id));
                pendingMessages = pendingMessages.filter(p => !historyIds.has(p.id));
                pendingMessages.forEach(p => {
                    if (p.room === currentRoom) addMessage(p, true);
                });
                break;
            case 'chat':
                if (msg.room === currentRoom) {
                    const statusEl = messageElements.get(msg.id);
                    if (statusEl) {
                        statusEl.textContent = ''; 
                        pendingMessages = pendingMessages.filter(p => p.id !== msg.id);
                    } else {
                        addMessage(msg, false);
                    }
                }
                break;
            case 'user-list':
                renderUserList(msg.users);
                break;
        }
    });
}

// 4. WAIT FOR DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}