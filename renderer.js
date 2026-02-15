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

let GIPHY_API_KEY = null;


let editingMessageId = null; // Stores the ID of the message being edited

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

    const gifBtn = document.getElementById('gifBtn');
    const gifPicker = document.getElementById('gifPicker');
    const gifSearch = document.getElementById('gifSearch');
    const gifResults = document.getElementById('gifResults');

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

    if (gifBtn && gifPicker && gifSearch && gifResults) {
        
        gifBtn.onclick = () => {
            const isHidden = gifPicker.style.display === 'none';
            gifPicker.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) {
                gifSearch.focus();
                // Optional: Fetch trending if search is empty
                if (gifSearch.value === '') fetchTrendingGifs(); 
            }
        };

        gifSearch.oninput = async () => {
            const query = gifSearch.value.trim();
            if (query.length < 2) return;
            
            if (!GIPHY_API_KEY) {
                console.error("Giphy Key not received from server yet");
                return;
            }

            const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${query}&limit=20&rating=g`;
            const response = await fetch(url);
            const { data } = await response.json();
            renderGifs(data);
        };
    } else {
        console.warn("GIF Picker elements missing from HTML. GIF feature disabled.");
    }

    let typingTimeout;
    let isCurrentlyTyping = false;

    input.oninput = () => {
        // If we aren't already marked as typing, tell the server
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true;
            chat.sendMessage({ type: 'typing', room: currentRoom, username });
        }

        // Clear the existing timer
        clearTimeout(typingTimeout);

        // Set a timer to reset our typing state after 1.5 seconds of silence
        typingTimeout = setTimeout(() => {
            isCurrentlyTyping = false;
            // Optional: Tell the server we stopped so others can hide the indicator immediately
            chat.sendMessage({ type: 'stop-typing', room: currentRoom, username });
        }, 1500);
    };

    async function fetchTrendingGifs() {
        if (!GIPHY_API_KEY) return;

        // Trending endpoint shows what's popular right now
        const url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20&rating=g`;
        
        try {
            const response = await fetch(url);
            const { data } = await response.json();
            renderGifs(data); // Reuse your existing renderGifs logic
        } catch (err) {
            console.error("Giphy Trending Error:", err);
        }
    }

    // Close GIF picker when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
        const gifPicker = document.getElementById('gifPicker');
        const gifBtn = document.getElementById('gifBtn');

        // If the picker is open AND the click was NOT on the picker or the button
        if (gifPicker.style.display === 'flex' && 
            !gifPicker.contains(e.target) && 
            !gifBtn.contains(e.target)) {
            
            gifPicker.style.display = 'none';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const gifPicker = document.getElementById('gifPicker');
            if (gifPicker.style.display === 'flex') {
                gifPicker.style.display = 'none';
            }
        }
    });

    function renderGifs(results) {
        gifResults.innerHTML = '';
        results.forEach(gif => {
            const img = document.createElement('img');
            // 'fixed_width_small' is perfect for the picker grid
            img.src = gif.images.fixed_width_small.url;
            img.style.width = '100%';
            img.style.borderRadius = '4px';
            img.style.cursor = 'pointer';
            
            img.onclick = () => {
                // Send the high-quality original GIF URL
                chat.sendMessage({
                    type: 'chat',
                    id: crypto.randomUUID(),
                    room: currentRoom,
                    username: username,
                    content: gif.images.original.url, 
                    timestamp: Date.now()
                });
                document.getElementById('gifPicker').style.display = 'none';
                gifSearch.value = '';
            };
            gifResults.appendChild(img);
        });
    }

    function addMessage(msg, isPending = false) {
        // 1. Guard against duplicates
        if (messageElements.has(msg.id) && !isPending && !msg.is_edited) return;

        // 2. Remove existing for edits
        const existingMsg = document.getElementById(`msg-${msg.id}`);
        if (existingMsg) existingMsg.remove();

        // 3. Create Wrapper
        const wrapper = document.createElement('div');
        wrapper.id = `msg-${msg.id}`;
        wrapper.className = `message ${msg.username === username ? 'own' : 'other'}`;

        // 4. Build Metadata (Username + Edited Tag)
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = msg.username; 
        if (msg.is_edited) {
            const edited = document.createElement('small');
            edited.style.cssText = "opacity: 0.5; margin-left: 5px;";
            edited.textContent = '(edited)';
            meta.appendChild(edited);
        }
        wrapper.appendChild(meta);

        // 5. Build Content (Image or Text)
        const isImage = msg.content.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null || 
                        msg.content.includes("giphy.com/media");

        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';

        if (isImage) {
            const img = document.createElement('img');
            img.src = msg.content;
            img.style.cssText = "max-width: 250px; max-height: 200px; border-radius: 8px; display: block; margin-top: 5px; object-fit: contain; background: #2f3136;";
            contentDiv.style.cssText = "background: none; padding: 0;";
            contentDiv.appendChild(img);
        } else {
            contentDiv.textContent = msg.content; // XSS Protection
        }
        wrapper.appendChild(contentDiv);

        // 6. Add Timestamp
        const timeString = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const timeSpan = document.createElement('span');
        timeSpan.className = 'hover-timestamp';
        timeSpan.textContent = timeString;
        wrapper.appendChild(timeSpan);

        // 7. Ownership Features (Status & Context Menus)
        if (msg.username === username) {
            // Pending Status
            const statusDiv = document.createElement('div');
            statusDiv.className = 'status';
            statusDiv.textContent = isPending ? 'pending' : '';
            wrapper.appendChild(statusDiv);
            messageElements.set(msg.id, statusDiv);

            // Mobile Long Press
            let pressTimer;
            wrapper.ontouchstart = (e) => {
                pressTimer = window.setTimeout(() => {
                    const touch = e.touches[0];
                    showContextMenu(touch.pageX, touch.pageY, msg);
                }, 600);
            };
            wrapper.ontouchend = () => clearTimeout(pressTimer);
            wrapper.ontouchmove = () => clearTimeout(pressTimer);

            // PC Right Click
            wrapper.oncontextmenu = (e) => {
                e.preventDefault();
                showContextMenu(e.pageX, e.pageY, msg);
            };
        }

        messagesDiv.appendChild(wrapper);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function showContextMenu(x, y, msg) {
        const existing = document.getElementById('ctx-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'ctx-menu';
        // Discord-like dark theme for the menu
        menu.style = `position:fixed; top:${y}px; left:${x}px; background:#18191c; color:#dcddde; border-radius:4px; padding:8px 0; z-index:10000; box-shadow: 0 8px 16px rgba(0,0,0,0.24); min-width:120px; font-size: 14px; border: 1px solid #000;`;
        
        menu.innerHTML = `
            <div id="edit-opt" style="padding:8px 12px; cursor:pointer;">Edit Message</div>
            <div id="del-opt" style="padding:8px 12px; cursor:pointer; color:#f04747;">Delete Message</div>
        `;
        document.body.appendChild(menu);

        document.getElementById('edit-opt').onclick = () => {
            editingMessageId = msg.id;
            input.value = msg.content; // Put the message text into the main input
            input.focus();
            
            // Change the UI to show we are in "Edit Mode"
            sendBtn.textContent = "Save";
            input.style.borderLeft = "4px solid #faa61a"; // A little orange indicator
            input.placeholder = "Editing message... (Esc to cancel)";
            
            menu.remove();
        };

        document.getElementById('del-opt').onclick = () => {
            if (confirm("Permanently delete this message?")) {
                chat.sendMessage({ type: 'delete-message', id: msg.id, room: currentRoom, username });
            }
            menu.remove();
        };

        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        setTimeout(() => window.addEventListener('click', closeMenu), 10);
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
        if (editingMessageId) {
            // --- SAVE THE EDIT ---
            chat.sendMessage({
                type: 'edit-message',
                id: editingMessageId,
                room: currentRoom,
                username: username,
                newContent: content
            });
            
            // Reset the UI
            exitEditMode();
        } else {
            // --- SEND NEW MESSAGE (Original Logic) ---
            const msgId = crypto.randomUUID();
            const msgData = { 
                type: 'chat', id: msgId, room: currentRoom, 
                username, content, timestamp: Date.now() 
            };
            addMessage(msgData, true);
            pendingMessages.push(msgData);
            chat.sendMessage(msgData);
        }
        input.value = '';
    };

    function exitEditMode() {
        editingMessageId = null;
        sendBtn.textContent = "Send";
        input.style.borderLeft = "none";
        input.placeholder = "Message...";
        input.value = '';
    }

    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            sendBtn.click();
        }
        if (e.key === 'Escape' && editingMessageId) {
            exitEditMode();
        }
    };

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
                GIPHY_API_KEY = msg.giphyKey;
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
            case 'message-edited':
                const el = document.getElementById(`msg-${msg.id}`);
                if (el) {
                    el.querySelector('.content').textContent = msg.newContent;
                    // Add edited tag if not there
                    if (!el.querySelector('small')) {
                        el.querySelector('.meta').innerHTML += '<small style="opacity:0.5; margin-left:5px;">(edited)</small>';
                    }
                }
                break;
            case 'message-deleted':
                const toDel = document.getElementById(`msg-${msg.id}`);
                if (toDel) toDel.remove();
                break;
            case 'user-typing':
                // Find or create a typing indicator element
                let indicator = document.getElementById('typing-indicator');
                if (!indicator) {
                    indicator = document.createElement('div');
                    indicator.id = 'typing-indicator';
                    indicator.style.cssText = "font-size: 0.8rem; color: #8e9297; margin-bottom: 5px; margin-left: 20px; font-style: italic;";
                    messagesDiv.parentNode.insertBefore(indicator, messagesDiv.nextSibling);
                }
                indicator.textContent = `${msg.username} is typing...`;
                break;

            case 'user-stop-typing':
                const stopIndicator = document.getElementById('typing-indicator');
                if (stopIndicator) stopIndicator.textContent = '';
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