const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

let waitingPlayer = null;
let gameRooms = {};

// --- Central function for handling any type of player departure ---
function handlePlayerLeave(socket) {
    console.log(`Handling departure for socket: ${socket.id}`);
    // If the departing player was the one waiting for a game, clear them.
    if (waitingPlayer && waitingPlayer.id === socket.id) {
        waitingPlayer = null;
        console.log('The waiting player has left.');
    }

    // Find if the player was in a room, notify the opponent, and clean up.
    for (const room in gameRooms) {
        if (gameRooms[room] && gameRooms[room].players.includes(socket.id)) {
            const opponentId = gameRooms[room].players.find(id => id !== socket.id);
            if (opponentId) {
                io.to(opponentId).emit('opponentDisconnected');
            }
            // Clean up the room
            delete gameRooms[room];
            console.log(`Cleaned up room ${room} after player left.`);
            break; // Exit loop once handled
        }
    }
}


io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('findGame', () => {
        console.log(`Player ${socket.id} is looking for a game.`);
        if (waitingPlayer) {
            const room = `room_${socket.id}_${waitingPlayer.id}`;
            waitingPlayer.join(room);
            socket.join(room);
            gameRooms[room] = { players: [waitingPlayer.id, socket.id] };
            io.to(waitingPlayer.id).emit('gameStart', { symbol: 'X', room: room });
            io.to(socket.id).emit('gameStart', { symbol: 'O', room: room });
            console.log(`Game started in room ${room}`);
            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            io.to(socket.id).emit('waitingForOpponent');
        }
    });

    socket.on('makeMove', (data) => {
        // Broadcast to everyone in the room including the sender
        io.to(data.room).emit('moveMade', data.move);
    });

    socket.on('restartRequest', (data) => {
        // Broadcast to everyone in the room
        io.to(data.room).emit('resetBoard');
    });
    
    // Handle graceful "leave game" event from a client choosing another mode
    socket.on('leaveGame', () => {
        handlePlayerLeave(socket);
    });

    // Handle abrupt disconnects (e.g., closing the browser tab)
    socket.on('disconnect', () => {
        console.log(`User disconnected abruptly: ${socket.id}`);
        handlePlayerLeave(socket);
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});