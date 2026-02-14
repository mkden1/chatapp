const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusSpan = document.getElementById('status');
const usernameInput = document.getElementById('usernameInput');
const setUsernameBtn = document.getElementById('setUsernameBtn');
const roomsDiv = document.getElementById('rooms');
const newRoomControls = document.getElementById('newRoomControls');
const newRoomInput = document.getElementById('newRoomInput');
const confirmRoomBtn = document.getElementById('confirmRoomBtn');
const cancelRoomBtn = document.getElementById('cancelRoomBtn');

const userListDiv = document.getElementById('userList');
const userCountSpan = document.getElementById('userCount');
const messageElements = new Map(); 
let pendingMessages = []; 
let username = null;
let currentRoom = null;
let availableRooms = [];
let isIdentified = false;

// ----------------- UI Helpers -----------------
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
    // Clear sidebar but KEEP our newRoomControls div
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

confirmRoomBtn.onclick = () => {
    const name = newRoomInput.value.trim();
    if (name) {
        const sanitized = name.toLowerCase().replace(/\s+/g, '-');
        window.chatAPI.sendMessage({ type: 'create-room', room: sanitized });
        newRoomInput.value = '';
        newRoomControls.style.display = 'none';
    }
};

cancelRoomBtn.onclick = () => {
    newRoomInput.value = '';
    newRoomControls.style.display = 'none';
};

// Allow pressing "Enter" to submit the room
newRoomInput.onkeydown = (e) => {
    if (e.key === 'Enter') confirmRoomBtn.click();
    if (e.key === 'Escape') cancelRoomBtn.click();
};

function switchRoom(roomName) {
    if (roomName === currentRoom) return;
    currentRoom = roomName;
    messagesDiv.innerHTML = '';
    messageElements.clear();
    window.chatAPI.sendMessage({ type: 'join-room', room: currentRoom });
    renderRoomList();
}

// ----------------- Event Listeners -----------------
setUsernameBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) return;
    username = name;
    document.getElementById('login').style.display = 'none';
    window.chatAPI.sendMessage({ type: 'identify', username });
});

sendBtn.addEventListener('click', () => {
    const content = input.value.trim();
    if (!content || !currentRoom) return;
    
    const msgId = crypto.randomUUID();
    const msgData = { 
        type: 'chat', id: msgId, room: currentRoom, 
        username, content, timestamp: Date.now() 
    };

    addMessage(msgData, true);
    pendingMessages.push(msgData);
    window.chatAPI.sendMessage(msgData);
    input.value = '';
});

// ----------------- WebSocket Handling -----------------
window.chatAPI.onMessage((msg) => {
    switch (msg.type) {
        case 'identified':
            isIdentified = true;
            window.chatAPI.sendMessage({ type: 'get-rooms' });
            if (currentRoom) window.chatAPI.sendMessage({ type: 'join-room', room: currentRoom });
            break;

        case 'room-list':
            console.log("DEBUG: Received room-list from server:", msg.rooms);
            availableRooms = msg.rooms;
            if (!currentRoom && availableRooms.length > 0) switchRoom(availableRooms[0]);
            renderRoomList();
            break;

        case 'history':
            messagesDiv.innerHTML = '';
            messageElements.clear();
            msg.messages.forEach(m => addMessage(m, false));
            
            // Re-sync pending messages
            const historyIds = new Set(msg.messages.map(m => m.id));
            pendingMessages = pendingMessages.filter(p => !historyIds.has(p.id));
            pendingMessages.forEach(p => {
                if (p.room === currentRoom) {
                    addMessage(p, true);
                    window.chatAPI.sendMessage(p);
                }
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

window.chatAPI.onStatus(status => {
    statusSpan.textContent = status;
    statusSpan.style.color = status === 'Connected' ? '#43b581' : '#f04747';
    if (status === 'Connected' && username) {
        isIdentified = false;
        window.chatAPI.sendMessage({ type: 'identify', username });
    }
});

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