// ===== Global Variables =====
let socket;
let currentRoom = '';
let currentUsername = '';
let mySocketId = '';

// WebRTC
let localStream = null;
let screenStream = null;
let peerConnections = new Map(); // socketId -> RTCPeerConnection
let remoteStreams = new Map(); // socketId -> MediaStream

// Call State
let isInCall = false;
let isMicMuted = false;
let isCameraOff = false;
let isScreenSharing = false;
let currentCallType = null; // 'audio' or 'video'

// Recording
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingInterval = null;

// File Transfer
let filesToSend = [];
let receivingFiles = new Map(); // fileId -> {fileInfo, chunks}

// Timers
let callTimer = null;
let callDuration = 0;
let typingTimeout = null;

// ICE Servers Configuration
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// Emoji List
const emojis = [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
    '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
    '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓',
    '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
    '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾',
    '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋', '💌', '💘', '💝', '💖', '💗', '💓',
    '💞', '💕', '💟', '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💯', '💢', '💥', '💫', '💦', '💨',
    '🕳️', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '💤', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
    '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅',
    '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💏', '👨‍❤️‍💋‍👨', '👩‍❤️‍💋‍👩'
];

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing ConnectChat Ultra...');
    initializeSocket();
    initializeEventListeners();
    initializeEmojis();
    checkMediaDevices();
});

// ===== Socket Initialization =====
function initializeSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('✅ Connected to server');
        mySocketId = socket.id;
        console.log('My Socket ID:', mySocketId);
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected from server');
        showToast('Connection lost. Reconnecting...', 'error');
    });

    // Room Events
    socket.on('room-joined', ({ roomCode, users, userCount }) => {
        currentRoom = roomCode;
        showScreen('chat');
        document.getElementById('room-title').textContent = `Room: ${roomCode}`;
        document.getElementById('current-code').textContent = roomCode;
        updateUserCount(userCount);
        addSystemMessage(`Welcome to room ${roomCode}! 🎉`);

        if (users.length > 0) {
            addSystemMessage(`${users.length} user(s) already in the room`);
        }
    });

    socket.on('user-joined', ({ socketId, username, userCount }) => {
        addSystemMessage(`${username} joined the room 👋`);
        updateUserCount(userCount);
        showToast(`${username} joined!`, 'success');
    });

    socket.on('user-left', ({ userId, username, userCount }) => {
        addSystemMessage(`${username} left the room 👋`);
        updateUserCount(userCount);

        // Clean up peer connection if exists
        if (peerConnections.has(userId)) {
            closePeerConnection(userId);
        }
    });

    // Chat Events
    socket.on('chat-message', ({ message, username, time, senderId }) => {
        addMessage(message, username, time, false, senderId);
        playNotificationSound();
    });

    socket.on('user-typing', ({ username }) => {
        showTypingIndicator(username);
    });

    socket.on('user-stop-typing', () => {
        hideTypingIndicator();
    });

    // Call Events - FIXED
    socket.on('call-started', ({ callerId, callerName, callType, roomCode }) => {
        console.log(`📞 Call started by ${callerName} (${callerId})`);

        if (callerId === mySocketId) {
            console.log('This is our own call, ignoring');
            return;
        }

        if (!isInCall) {
            currentCallType = callType;
            showIncomingCallModal(callerName, callType, []);
        } else {
            console.log('Already in call, creating peer connection');
            setTimeout(() => {
                createPeerConnection(callerId, false);
            }, 1000);
        }
    });

    socket.on('user-joined-call', ({ userId, username }) => {
        console.log(`📞 ${username} (${userId}) joined the call`);

        if (userId === mySocketId) {
            console.log('This is us, ignoring');
            return;
        }

        showToast(`${username} joined the call`, 'info');

        if (isInCall) {
            setTimeout(() => {
                createPeerConnection(userId, true);
            }, 1000);
        }
    });

    socket.on('user-left-call', ({ userId }) => {
        console.log(`📞 User ${userId} left the call`);
        if (peerConnections.has(userId)) {
            closePeerConnection(userId);
            removeVideoElement(userId);
        }
    });

    socket.on('call-participants', ({ participants, roomCode }) => {
        console.log(`📋 Got participant list:`, participants);

        participants.forEach(participant => {
            if (participant.socketId !== mySocketId) {
                setTimeout(() => {
                    createPeerConnection(participant.socketId, true);
                }, 1000);
            }
        });
    });

    socket.on('call-ended', ({ endedBy }) => {
        showToast(`Call ended by ${endedBy}`, 'info');
        endCall();
    });

    // WebRTC Signaling - FIXED
    socket.on('offer', async ({ offer, from, fromName }) => {
        console.log(`📥 Received offer from: ${fromName} (${from})`);

        if (!isInCall) {
            console.log('⚠️ Not in call, ignoring offer');
            return;
        }

        if (!peerConnections.has(from)) {
            createPeerConnection(from, false);
        }

        const pc = peerConnections.get(from);
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('✅ Remote description set');

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log('✅ Answer created and set as local description');

            socket.emit('answer', {
                answer: answer,
                to: from
            });
            console.log('📤 Answer sent to', from);

        } catch (error) {
            console.error('❌ Error handling offer:', error);
        }
    });

    socket.on('answer', async ({ answer, from }) => {
        console.log(`📥 Received answer from: ${from}`);

        const pc = peerConnections.get(from);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('✅ Remote description (answer) set');
            } catch (error) {
                console.error('❌ Error handling answer:', error);
            }
        } else {
            console.error('❌ No peer connection found for', from);
        }
    });

    socket.on('ice-candidate', async ({ candidate, from }) => {
        console.log(`📥 Received ICE candidate from: ${from}`);

        const pc = peerConnections.get(from);
        if (pc && candidate) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('✅ ICE candidate added');
            } catch (error) {
                console.error('❌ Error adding ICE candidate:', error);
            }
        }
    });

    // Screen Sharing Events
    socket.on('screen-share-started', ({ userId, username }) => {
        showToast(`${username} is sharing screen`, 'info');
    });

    socket.on('screen-share-stopped', ({ userId }) => {
        console.log('Screen share stopped by', userId);
    });

    // File Transfer Events
    socket.on('file-info', ({ fileInfo, senderId, senderName }) => {
        showToast(`${senderName} is sending: ${fileInfo.name}`, 'info');

        const fileId = fileInfo.id;
        receivingFiles.set(fileId, {
            fileInfo: fileInfo,
            chunks: [],
            senderId: senderId,
            senderName: senderName
        });
    });

    socket.on('file-chunk', ({ chunk, chunkIndex, totalChunks, fileName, fileId }) => {
        const fileData = receivingFiles.get(fileId);
        if (fileData) {
            fileData.chunks.push(chunk);

            const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            console.log(`Receiving ${fileName}: ${progress}%`);
        }
    });

    socket.on('file-complete', ({ fileName, fileId, senderId }) => {
        const fileData = receivingFiles.get(fileId);
        if (fileData && fileData.chunks.length > 0) {
            const blob = new Blob(fileData.chunks.map(chunk => {
                const binary = atob(chunk);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                return bytes;
            }));

            addFileMessage(
                fileData.fileInfo.name,
                fileData.fileInfo.size,
                blob,
                false,
                fileData.senderName
            );

            showToast(`Received ${fileName}!`, 'success');
            receivingFiles.delete(fileId);
        }
    });
}

// ===== Event Listeners =====
function initializeEventListeners() {
    // Join Screen
    document.getElementById('generate-code').addEventListener('click', generateRoomCode);
    document.getElementById('join-btn').addEventListener('click', joinRoom);
    document.getElementById('room-code').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });

    // Chat Screen Header
    document.getElementById('leave-btn').addEventListener('click', leaveRoom);
    document.getElementById('copy-code-btn').addEventListener('click', copyRoomCode);
    document.getElementById('share-code-btn').addEventListener('click', shareRoomCode);

    // Call Buttons
    document.getElementById('voice-call-btn').addEventListener('click', () => startCall('audio'));
    document.getElementById('video-call-btn').addEventListener('click', () => startCall('video'));
    document.getElementById('screen-share-btn').addEventListener('click', toggleScreenShare);

    // Message Input
    document.getElementById('send-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    document.getElementById('message-input').addEventListener('input', handleTyping);

    // File Upload
    document.getElementById('attach-btn').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', handleFileSelect);
    document.getElementById('start-transfer').addEventListener('click', sendFiles);
    document.getElementById('cancel-transfer').addEventListener('click', () => {
        hideModal('file-modal');
        filesToSend = [];
    });

    // Emoji Picker
    document.getElementById('emoji-btn').addEventListener('click', toggleEmojiPicker);
    const closeEmojiBtn = document.querySelector('.close-emoji');
    if (closeEmojiBtn) {
        closeEmojiBtn.addEventListener('click', () => {
            document.getElementById('emoji-picker').classList.add('hidden');
        });
    }

    // Call Controls
    document.getElementById('toggle-mic').addEventListener('click', toggleMicrophone);
    document.getElementById('toggle-camera').addEventListener('click', toggleCamera);
    document.getElementById('share-screen').addEventListener('click', shareScreen);
    document.getElementById('start-recording').addEventListener('click', toggleRecording);
    document.getElementById('end-call-btn').addEventListener('click', endCall);

    // Incoming Call Modal
    document.getElementById('accept-call').addEventListener('click', acceptCall);
    document.getElementById('decline-call').addEventListener('click', declineCall);

    // Close modals on outside click
    document.addEventListener('click', (e) => {
        const emojiPicker = document.getElementById('emoji-picker');
        const emojiBtn = document.getElementById('emoji-btn');

        if (emojiPicker && emojiBtn && !emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
            emojiPicker.classList.add('hidden');
        }
    });
}

// ===== Initialize Emojis =====
function initializeEmojis() {
    const emojiGrid = document.getElementById('emoji-grid');

    emojis.forEach(emoji => {
        const button = document.createElement('button');
        button.textContent = emoji;
        button.addEventListener('click', () => {
            const input = document.getElementById('message-input');
            input.value += emoji;
            input.focus();
        });
        emojiGrid.appendChild(button);
    });
}

// ===== Room Functions =====
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('room-code').value = code;
}

function joinRoom() {
    const username = document.getElementById('username').value.trim();
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

    if (!username) {
        showToast('Please enter your name', 'error');
        document.getElementById('username').focus();
        return;
    }

    if (!roomCode) {
        showToast('Please enter a room code', 'error');
        document.getElementById('room-code').focus();
        return;
    }

    currentUsername = username;
    currentRoom = roomCode;

    socket.emit('join-room', { roomCode, username });
}

function leaveRoom() {
    if (isInCall) {
        endCall();
    }

    socket.emit('leave-room', { roomCode: currentRoom });
    showScreen('join');
    clearMessages();
    currentRoom = '';
    showToast('Left the room', 'info');
}

function copyRoomCode() {
    navigator.clipboard.writeText(currentRoom).then(() => {
        showToast('Room code copied!', 'success');
    });
}

function shareRoomCode() {
    if (navigator.share) {
        navigator.share({
            title: 'Join ConnectChat Ultra',
            text: `Join my room on ConnectChat Ultra! Room Code: ${currentRoom}`,
            url: window.location.href
        }).catch(() => {
            copyRoomCode();
        });
    } else {
        copyRoomCode();
    }
}

function updateUserCount(count) {
    const userCountEl = document.getElementById('user-count');
    userCountEl.innerHTML = `<i class="fas fa-circle pulse"></i> ${count} online`;
}

// ===== Message Functions =====
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (!message) return;

    const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    socket.emit('chat-message', {
        roomCode: currentRoom,
        message: message,
        username: currentUsername
    });

    addMessage(message, currentUsername, time, true, mySocketId);
    input.value = '';

    socket.emit('stop-typing', { roomCode: currentRoom });
}

function addMessage(text, sender, time, isSent, senderId) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.dataset.senderId = senderId;

    messageDiv.innerHTML = `
        ${!isSent ? `<div class="sender">${escapeHtml(sender)}</div>` : ''}
        <div class="text">${escapeHtml(text)}</div>
        <div class="time">${time}</div>
    `;

    messagesDiv.appendChild(messageDiv);
    scrollToBottom();
}

function addSystemMessage(text) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.textContent = text;

    messagesDiv.appendChild(messageDiv);
    scrollToBottom();
}

function addFileMessage(fileName, fileSize, blob, isSent, senderName = null) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message file ${isSent ? 'sent' : 'received'}`;

    const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    const fileIcon = getFileIcon(fileName);
    const formattedSize = formatFileSize(fileSize);
    const downloadId = 'download-' + Date.now();

    messageDiv.innerHTML = `
        ${!isSent && senderName ? `<div class="sender">${escapeHtml(senderName)}</div>` : ''}
        <div class="file-preview">
            <div class="file-icon">
                <i class="fas ${fileIcon}"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${escapeHtml(fileName)}</div>
                <div class="file-size">${formattedSize}</div>
            </div>
            ${blob ? `<button class="download-btn" id="${downloadId}">
                <i class="fas fa-download"></i>
            </button>` : ''}
        </div>
        <div class="time">${time}</div>
    `;

    messagesDiv.appendChild(messageDiv);

    if (blob) {
        document.getElementById(downloadId).addEventListener('click', () => {
            downloadFile(fileName, blob);
        });
    }

    scrollToBottom();
}

function handleTyping() {
    socket.emit('typing', {
        roomCode: currentRoom,
        username: currentUsername
    });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop-typing', { roomCode: currentRoom });
    }, 1000);
}

function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    indicator.querySelector('.typing-text').textContent = `${username} is typing`;
    indicator.classList.remove('hidden');
}

function hideTypingIndicator() {
    document.getElementById('typing-indicator').classList.add('hidden');
}

function scrollToBottom() {
    const container = document.querySelector('.messages-container');
    container.scrollTop = container.scrollHeight;
}

function clearMessages() {
    document.getElementById('messages').innerHTML = '';
}

// ===== File Transfer Functions =====
function handleFileSelect(event) {
    filesToSend = Array.from(event.target.files);

    if (filesToSend.length === 0) return;

    displayFileList();
    showModal('file-modal');
}

function displayFileList() {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    filesToSend.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';

        const fileIcon = getFileIcon(file.name);
        const fileSize = formatFileSize(file.size);

        fileItem.innerHTML = `
            <div class="file-icon">
                <i class="fas ${fileIcon}"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${escapeHtml(file.name)}</div>
                <div class="file-size">${fileSize}</div>
            </div>
        `;

        fileList.appendChild(fileItem);
    });
}

async function sendFiles() {
    if (filesToSend.length === 0) return;

    const progressSection = document.getElementById('transfer-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-percentage');
    const progressFileName = document.getElementById('progress-file-name');

    progressSection.classList.remove('hidden');
    document.getElementById('start-transfer').disabled = true;

    for (const file of filesToSend) {
        progressFileName.textContent = `Sending ${file.name}...`;
        await sendFile(file, (progress) => {
            progressFill.style.width = `${progress}%`;
            progressText.textContent = `${progress}%`;
        });
    }

    hideModal('file-modal');
    progressSection.classList.add('hidden');
    document.getElementById('start-transfer').disabled = false;
    document.getElementById('file-input').value = '';
    filesToSend = [];

    showToast('Files sent successfully!', 'success');
}

async function sendFile(file, progressCallback) {
    const chunkSize = 64 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const fileId = generateFileId();

    socket.emit('file-info', {
        roomCode: currentRoom,
        fileInfo: {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type
        }
    });

    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        const base64 = await readChunkAsBase64(chunk);

        socket.emit('file-chunk', {
            roomCode: currentRoom,
            chunk: base64,
            chunkIndex: i,
            totalChunks: totalChunks,
            fileName: file.name,
            fileId: fileId
        });

        const progress = Math.round(((i + 1) / totalChunks) * 100);
        progressCallback(progress);

        await new Promise(resolve => setTimeout(resolve, 10));
    }

    socket.emit('file-complete', {
        roomCode: currentRoom,
        fileName: file.name,
        fileId: fileId
    });

    addFileMessage(file.name, file.size, null, true);
}

function readChunkAsBase64(chunk) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const arrayBuffer = reader.result;
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            resolve(btoa(binary));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(chunk);
    });
}

function downloadFile(fileName, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function generateFileId() {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ===== WebRTC Call Functions - FIXED =====
async function startCall(callType) {
    console.log(`🎥 Starting ${callType} call...`);
    currentCallType = callType;

    try {
        showLoadingOverlay('Getting camera/mic access...');

        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            },
            video: callType === 'video' ? {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30, max: 30 }
            } : false
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('✅ Got local stream:', localStream.getTracks());

        hideLoadingOverlay();

        socket.emit('call-start', {
            roomCode: currentRoom,
            callType: callType
        });

        socket.emit('call-join', { roomCode: currentRoom });

        isInCall = true;
        showScreen('call');

        addVideoElement(mySocketId, localStream, currentUsername, true);

        startCallTimer();
        updateCallParticipantsCount(1);

        showToast('Call started! Waiting for others...', 'success');

    } catch (error) {
        console.error('❌ Error starting call:', error);
        hideLoadingOverlay();

        if (error.name === 'NotAllowedError') {
            showToast('Please allow camera/microphone access!', 'error');
        } else if (error.name === 'NotFoundError') {
            showToast('No camera/microphone found!', 'error');
        } else {
            showToast('Failed to start call: ' + error.message, 'error');
        }
    }
}

function createPeerConnection(remoteSocketId, shouldCreateOffer) {
    console.log(`🔗 Creating peer connection with ${remoteSocketId}, shouldOffer: ${shouldCreateOffer}`);

    if (remoteSocketId === mySocketId) {
        console.log('⚠️ Skipping connection to self');
        return null;
    }

    if (peerConnections.has(remoteSocketId)) {
        console.log('⚠️ Connection already exists');
        return peerConnections.get(remoteSocketId);
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnections.set(remoteSocketId, pc);

    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`➕ Adding local ${track.kind} track to peer connection`);
            pc.addTrack(track, localStream);
        });
    }

    pc.ontrack = (event) => {
        console.log(`📹 Received remote ${event.track.kind} track from ${remoteSocketId}`);

        if (!remoteStreams.has(remoteSocketId)) {
            const remoteStream = new MediaStream();
            remoteStreams.set(remoteSocketId, remoteStream);

            const username = 'User';
            addVideoElement(remoteSocketId, remoteStream, username, false);
        }

        const remoteStream = remoteStreams.get(remoteSocketId);
        remoteStream.addTrack(event.track);

        console.log(`✅ Remote stream now has ${remoteStream.getTracks().length} tracks`);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`📤 Sending ICE candidate to ${remoteSocketId}`);
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: remoteSocketId
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`🔌 Connection state with ${remoteSocketId}: ${pc.connectionState}`);

        if (pc.connectionState === 'connected') {
            updateCallStatus('Connected');
            showToast('Connected to peer!', 'success');
        } else if (pc.connectionState === 'failed') {
            console.error('❌ Connection failed');
            showToast('Connection failed, retrying...', 'error');
            closePeerConnection(remoteSocketId);
        } else if (pc.connectionState === 'disconnected') {
            console.warn('⚠️ Connection disconnected');
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`🧊 ICE state with ${remoteSocketId}: ${pc.iceConnectionState}`);
    };

    if (shouldCreateOffer) {
        setTimeout(() => {
            createAndSendOffer(remoteSocketId);
        }, 500);
    }

    return pc;
}

async function createAndSendOffer(remoteSocketId) {
    const pc = peerConnections.get(remoteSocketId);
    if (!pc) {
        console.error('❌ No peer connection found for', remoteSocketId);
        return;
    }

    try {
        console.log(`📤 Creating offer for ${remoteSocketId}...`);

        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });

        await pc.setLocalDescription(offer);
        console.log('✅ Local description set');

        socket.emit('offer', {
            offer: offer,
            to: remoteSocketId,
            roomCode: currentRoom
        });

        console.log('✅ Offer sent to', remoteSocketId);

    } catch (error) {
        console.error('❌ Error creating offer:', error);
        showToast('Failed to create connection', 'error');
    }
}

function closePeerConnection(socketId) {
    const pc = peerConnections.get(socketId);
    if (pc) {
        pc.close();
        peerConnections.delete(socketId);
    }

    if (remoteStreams.has(socketId)) {
        const stream = remoteStreams.get(socketId);
        stream.getTracks().forEach(track => track.stop());
        remoteStreams.delete(socketId);
    }

    removeVideoElement(socketId);
}

function addVideoElement(socketId, stream, username, isLocal) {
    removeVideoElement(socketId);

    const videoGrid = document.getElementById('video-grid');
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `video-${socketId}`;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;

    const overlay = document.createElement('div');
    overlay.className = 'video-overlay';
    overlay.innerHTML = `
        <span class="participant-name">${escapeHtml(username)}${isLocal ? ' (You)' : ''}</span>
        <div class="video-status">
            <div class="status-icon" id="mic-status-${socketId}">
                <i class="fas fa-microphone"></i>
            </div>
            <div class="status-icon" id="cam-status-${socketId}">
                <i class="fas fa-video"></i>
            </div>
        </div>
    `;

    wrapper.appendChild(video);
    wrapper.appendChild(overlay);
    videoGrid.appendChild(wrapper);

    updateVideoGridLayout();

    const participantCount = document.querySelectorAll('.video-wrapper').length;
    updateCallParticipantsCount(participantCount);
}

function removeVideoElement(socketId) {
    const element = document.getElementById(`video-${socketId}`);
    if (element) {
        element.remove();
        updateVideoGridLayout();

        const participantCount = document.querySelectorAll('.video-wrapper').length;
        updateCallParticipantsCount(participantCount);
    }
}

function updateVideoGridLayout() {
    const videoGrid = document.getElementById('video-grid');
    const videoCount = videoGrid.children.length;

    videoGrid.className = 'video-grid';

    if (videoCount <= 1) {
        videoGrid.classList.add('grid-1');
    } else if (videoCount === 2) {
        videoGrid.classList.add('grid-2');
    } else if (videoCount <= 4) {
        videoGrid.classList.add('grid-4');
    } else if (videoCount <= 6) {
        videoGrid.classList.add('grid-6');
    } else {
        videoGrid.classList.add('grid-9');
    }
}

function toggleMicrophone() {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMicMuted = !audioTrack.enabled;

        const btn = document.getElementById('toggle-mic');
        btn.classList.toggle('active', audioTrack.enabled);
        btn.innerHTML = audioTrack.enabled
            ? '<i class="fas fa-microphone"></i>'
            : '<i class="fas fa-microphone-slash"></i>';

        const statusIcon = document.getElementById(`mic-status-${mySocketId}`);
        if (statusIcon) {
            statusIcon.classList.toggle('muted', !audioTrack.enabled);
        }
    }
}

function toggleCamera() {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        isCameraOff = !videoTrack.enabled;

        const btn = document.getElementById('toggle-camera');
        btn.classList.toggle('active', videoTrack.enabled);
        btn.innerHTML = videoTrack.enabled
            ? '<i class="fas fa-video"></i>'
            : '<i class="fas fa-video-slash"></i>';

        const statusIcon = document.getElementById(`cam-status-${mySocketId}`);
        if (statusIcon) {
            statusIcon.classList.toggle('muted', !videoTrack.enabled);
        }
    }
}

async function shareScreen() {
    try {
        if (!isScreenSharing) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always'
                },
                audio: false
            });

            const screenTrack = screenStream.getVideoTracks()[0];

            peerConnections.forEach((pc, socketId) => {
                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            });

            const myVideo = document.querySelector(`#video-${mySocketId} video`);
            if (myVideo) {
                myVideo.srcObject = screenStream;
                document.getElementById(`video-${mySocketId}`).classList.add('screen-share');
            }

            screenTrack.onended = () => {
                stopScreenShare();
            };

            isScreenSharing = true;
            document.getElementById('share-screen').classList.add('active');

            socket.emit('screen-share-start', { roomCode: currentRoom });
            showToast('Screen sharing started', 'success');

        } else {
            stopScreenShare();
        }
    } catch (error) {
        console.error('Error sharing screen:', error);
        showToast('Failed to share screen', 'error');
    }
}

function stopScreenShare() {
    if (!screenStream) return;

    screenStream.getTracks().forEach(track => track.stop());

    const videoTrack = localStream.getVideoTracks()[0];
    peerConnections.forEach((pc, socketId) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
        }
    });

    const myVideo = document.querySelector(`#video-${mySocketId} video`);
    if (myVideo) {
        myVideo.srcObject = localStream;
        document.getElementById(`video-${mySocketId}`).classList.remove('screen-share');
    }

    screenStream = null;
    isScreenSharing = false;
    document.getElementById('share-screen').classList.remove('active');

    socket.emit('screen-share-stop', { roomCode: currentRoom });
    showToast('Screen sharing stopped', 'info');
}

async function toggleScreenShare() {
    if (!isInCall) {
        showToast('Join a call first', 'error');
        return;
    }

    await shareScreen();
}

// ===== Call Recording =====
async function toggleRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        startRecording();
    } else {
        stopRecording();
    }
}

function startRecording() {
    if (!localStream) {
        showToast('No active stream to record', 'error');
        return;
    }

    try {
        const options = { mimeType: 'video/webm;codecs=vp9' };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/webm;codecs=vp8';
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/webm';
            }
        }

        mediaRecorder = new MediaRecorder(localStream, options);
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ConnectChat_Recording_${Date.now()}.webm`;
            a.click();
            URL.revokeObjectURL(url);

            showToast('Recording saved!', 'success');
        };

        mediaRecorder.start(1000);

        document.getElementById('start-recording').classList.add('recording');
        document.getElementById('recording-indicator').classList.remove('hidden');

        recordingStartTime = Date.now();
        recordingInterval = setInterval(updateRecordingTime, 1000);

        showToast('Recording started', 'success');

    } catch (error) {
        console.error('Error starting recording:', error);
        showToast('Failed to start recording', 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();

        document.getElementById('start-recording').classList.remove('recording');
        document.getElementById('recording-indicator').classList.add('hidden');

        if (recordingInterval) {
            clearInterval(recordingInterval);
            recordingInterval = null;
        }
    }
}

function updateRecordingTime() {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    document.getElementById('recording-time').textContent = `${minutes}:${seconds}`;
}

// ===== End Call =====
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    peerConnections.forEach((pc, socketId) => {
        closePeerConnection(socketId);
    });
    peerConnections.clear();
    remoteStreams.clear();

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        stopRecording();
    }

    document.getElementById('video-grid').innerHTML = '';

    isInCall = false;
    isMicMuted = false;
    isCameraOff = false;
    isScreenSharing = false;
    currentCallType = null;

    stopCallTimer();

    socket.emit('call-leave', { roomCode: currentRoom });

    showScreen('chat');

    showToast('Call ended', 'info');
}

// ===== Call Timer =====
function startCallTimer() {
    callDuration = 0;
    updateCallTimerDisplay();

    callTimer = setInterval(() => {
        callDuration++;
        updateCallTimerDisplay();
    }, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    callDuration = 0;
    updateCallTimerDisplay();
}

function updateCallTimerDisplay() {
    const minutes = Math.floor(callDuration / 60).toString().padStart(2, '0');
    const seconds = (callDuration % 60).toString().padStart(2, '0');
    document.getElementById('call-timer').textContent = `${minutes}:${seconds}`;
}

function updateCallStatus(status) {
    document.getElementById('call-status').textContent = status;
}

function updateCallParticipantsCount(count) {
    document.getElementById('call-participants-count').textContent = count;
}

// ===== Incoming Call Modal =====
function showIncomingCallModal(callerName, callType, participants) {
    document.getElementById('caller-name').textContent = callerName;
    document.getElementById('call-type-text').textContent =
        callType === 'video' ? 'is starting a video call...' : 'is starting a voice call...';

    showModal('incoming-call-modal');
}

function hideIncomingCallModal() {
    hideModal('incoming-call-modal');
}

async function acceptCall() {
    console.log('✅ Accepting call...');
    hideIncomingCallModal();

    try {
        showLoadingOverlay('Joining call...');

        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            },
            video: currentCallType === 'video' ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            } : false
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('✅ Got local stream');

        hideLoadingOverlay();

        socket.emit('call-join', { roomCode: currentRoom });

        isInCall = true;
        showScreen('call');

        addVideoElement(mySocketId, localStream, currentUsername, true);

        startCallTimer();

        showToast('Joined the call!', 'success');

    } catch (error) {
        console.error('❌ Error accepting call:', error);
        hideLoadingOverlay();
        showToast('Failed to join call: ' + error.message, 'error');
    }
}

function declineCall() {
    hideIncomingCallModal();
    showToast('Call declined', 'info');
}

// ===== Media Device Check =====
async function checkMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasAudio = devices.some(device => device.kind === 'audioinput');
        const hasVideo = devices.some(device => device.kind === 'videoinput');

        console.log('🎤 Audio devices:', hasAudio);
        console.log('📹 Video devices:', hasVideo);

        if (!hasAudio) {
            console.warn('No audio input device found');
        }
        if (!hasVideo) {
            console.warn('No video input device found');
        }
    } catch (error) {
        console.error('Error checking media devices:', error);
    }
}

// ===== Utility Functions =====
function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(`${screenName}-screen`).classList.add('active');
}

function showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

function showLoadingOverlay(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    overlay.querySelector('p').textContent = message;
    overlay.classList.remove('hidden');
}

function hideLoadingOverlay() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function toggleEmojiPicker() {
    document.getElementById('emoji-picker').classList.toggle('hidden');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const icons = {
        pdf: 'fa-file-pdf',
        doc: 'fa-file-word',
        docx: 'fa-file-word',
        xls: 'fa-file-excel',
        xlsx: 'fa-file-excel',
        ppt: 'fa-file-powerpoint',
        pptx: 'fa-file-powerpoint',
        txt: 'fa-file-alt',
        jpg: 'fa-file-image',
        jpeg: 'fa-file-image',
        png: 'fa-file-image',
        gif: 'fa-file-image',
        svg: 'fa-file-image',
        bmp: 'fa-file-image',
        mp4: 'fa-file-video',
        mkv: 'fa-file-video',
        avi: 'fa-file-video',
        mov: 'fa-file-video',
        wmv: 'fa-file-video',
        mp3: 'fa-file-audio',
        wav: 'fa-file-audio',
        flac: 'fa-file-audio',
        zip: 'fa-file-archive',
        rar: 'fa-file-archive',
        '7z': 'fa-file-archive',
        tar: 'fa-file-archive',
        js: 'fa-file-code',
        html: 'fa-file-code',
        css: 'fa-file-code',
        json: 'fa-file-code',
        xml: 'fa-file-code'
    };

    return icons[ext] || 'fa-file';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas ${icons[type]}"></i>
        </div>
        <div class="toast-message">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.1;

        oscillator.start();
        setTimeout(() => oscillator.stop(), 100);
    } catch (error) {
        // Silent fail
    }
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        sendMessage();
    }

    if (e.key === 'Escape') {
        document.querySelectorAll('.modal:not(.hidden)').forEach(modal => {
            modal.classList.add('hidden');
        });
        document.getElementById('emoji-picker').classList.add('hidden');
    }
});

// ===== Cleanup on page unload =====
window.addEventListener('beforeunload', () => {
    if (isInCall) {
        endCall();
    }
    if (currentRoom) {
        socket.emit('leave-room', { roomCode: currentRoom });
    }
});

console.log(`
╔════════════════════════════════════════╗
║   🚀 ConnectChat Ultra - Ready!        ║
║                                        ║
║   ✅ Group Calls Fixed                 ║
║   ✅ Screen Sharing                    ║
║   ✅ Call Recording                    ║
║   ✅ File Transfer                     ║
╚════════════════════════════════════════╝
`);