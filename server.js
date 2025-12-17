const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static('public'));

const rooms = new Map();
const users = new Map();
const roomCalls = new Map();

io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    socket.on('join-room', ({ roomCode, username }) => {
        socket.join(roomCode);

        if (!rooms.has(roomCode)) {
            rooms.set(roomCode, new Set());
        }
        rooms.get(roomCode).add(socket.id);

        users.set(socket.id, { username, roomCode, socketId: socket.id });

        const roomUsers = [];
        rooms.get(roomCode).forEach(id => {
            if (users.has(id)) {
                const user = users.get(id);
                roomUsers.push({
                    socketId: id,
                    username: user.username
                });
            }
        });

        socket.to(roomCode).emit('user-joined', {
            socketId: socket.id,
            username: username,
            userCount: rooms.get(roomCode).size
        });

        socket.emit('room-joined', {
            roomCode,
            users: roomUsers.filter(u => u.socketId !== socket.id),
            userCount: rooms.get(roomCode).size
        });

        console.log(`👤 ${username} joined room: ${roomCode}`);
    });

    socket.on('chat-message', ({ roomCode, message, username }) => {
        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        socket.to(roomCode).emit('chat-message', {
            message,
            username,
            time: timestamp,
            senderId: socket.id
        });
    });

    socket.on('typing', ({ roomCode, username }) => {
        socket.to(roomCode).emit('user-typing', { username });
    });

    socket.on('stop-typing', ({ roomCode }) => {
        socket.to(roomCode).emit('user-stop-typing');
    });

    // FIXED: Call signaling
    socket.on('call-start', ({ roomCode, callType }) => {
        console.log(`📞 ${users.get(socket.id)?.username} starting ${callType} call in ${roomCode}`);

        if (!roomCalls.has(roomCode)) {
            roomCalls.set(roomCode, new Set());
        }
        roomCalls.get(roomCode).add(socket.id);

        const user = users.get(socket.id);

        // Notify ALL users in room about call
        io.in(roomCode).emit('call-started', {
            callerId: socket.id,
            callerName: user?.username,
            callType,
            roomCode
        });
    });

    socket.on('call-join', ({ roomCode }) => {
        console.log(`📞 ${users.get(socket.id)?.username} joining call in ${roomCode}`);

        if (!roomCalls.has(roomCode)) {
            roomCalls.set(roomCode, new Set());
        }
        roomCalls.get(roomCode).add(socket.id);

        const user = users.get(socket.id);

        // Get all other participants
        const participants = [];
        roomCalls.get(roomCode).forEach(id => {
            if (id !== socket.id && users.has(id)) {
                participants.push({
                    socketId: id,
                    username: users.get(id).username
                });
            }
        });

        // Tell new joiner about existing participants
        socket.emit('call-participants', {
            participants,
            roomCode
        });

        // Tell others about new joiner
        socket.to(roomCode).emit('user-joined-call', {
            userId: socket.id,
            username: user?.username
        });

        console.log(`✅ ${user?.username} joined call. Total participants: ${roomCalls.get(roomCode).size}`);
    });

    // FIXED: WebRTC signaling with better logging
    socket.on('offer', ({ offer, to, roomCode }) => {
        console.log(`📤 Sending offer from ${socket.id} to ${to}`);
        io.to(to).emit('offer', {
            offer,
            from: socket.id,
            fromName: users.get(socket.id)?.username
        });
    });

    socket.on('answer', ({ answer, to }) => {
        console.log(`📤 Sending answer from ${socket.id} to ${to}`);
        io.to(to).emit('answer', {
            answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
        console.log(`📤 Sending ICE candidate from ${socket.id} to ${to}`);
        io.to(to).emit('ice-candidate', {
            candidate,
            from: socket.id
        });
    });

    socket.on('call-leave', ({ roomCode }) => {
        if (roomCalls.has(roomCode)) {
            roomCalls.get(roomCode).delete(socket.id);
            socket.to(roomCode).emit('user-left-call', {
                userId: socket.id
            });

            if (roomCalls.get(roomCode).size === 0) {
                roomCalls.delete(roomCode);
            }
        }
    });

    socket.on('end-call', ({ roomCode }) => {
        if (roomCalls.has(roomCode)) {
            socket.to(roomCode).emit('call-ended', {
                endedBy: users.get(socket.id)?.username
            });
            roomCalls.delete(roomCode);
        }
    });

    socket.on('screen-share-start', ({ roomCode }) => {
        socket.to(roomCode).emit('screen-share-started', {
            userId: socket.id,
            username: users.get(socket.id)?.username
        });
    });

    socket.on('screen-share-stop', ({ roomCode }) => {
        socket.to(roomCode).emit('screen-share-stopped', {
            userId: socket.id
        });
    });

    socket.on('file-info', ({ roomCode, fileInfo }) => {
        socket.to(roomCode).emit('file-info', {
            fileInfo,
            senderId: socket.id,
            senderName: users.get(socket.id)?.username
        });
    });

    socket.on('file-chunk', ({ roomCode, chunk, chunkIndex, totalChunks, fileName, fileId }) => {
        socket.to(roomCode).emit('file-chunk', {
            chunk,
            chunkIndex,
            totalChunks,
            fileName,
            fileId
        });
    });

    socket.on('file-complete', ({ roomCode, fileName, fileId }) => {
        socket.to(roomCode).emit('file-complete', {
            fileName,
            fileId,
            senderId: socket.id
        });
    });

    socket.on('leave-room', ({ roomCode }) => {
        handleUserLeave(socket, roomCode);
    });

    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            handleUserLeave(socket, user.roomCode);
        }
        console.log('❌ User disconnected:', socket.id);
    });

    function handleUserLeave(socket, roomCode) {
        if (rooms.has(roomCode)) {
            rooms.get(roomCode).delete(socket.id);

            const user = users.get(socket.id);
            socket.to(roomCode).emit('user-left', {
                userId: socket.id,
                username: user?.username,
                userCount: rooms.get(roomCode).size
            });

            if (rooms.get(roomCode).size === 0) {
                rooms.delete(roomCode);
            }
        }

        if (roomCalls.has(roomCode)) {
            roomCalls.get(roomCode).delete(socket.id);
            socket.to(roomCode).emit('user-left-call', {
                userId: socket.id
            });
        }

        users.delete(socket.id);
        socket.leave(roomCode);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   🚀 ConnectChat Ultra Server Ready    ║
║                                        ║
║   🌐 http://localhost:${PORT}            ║
║                                        ║
║   ✅ Group Calls Fixed!                ║
╚════════════════════════════════════════╝
    `);
});