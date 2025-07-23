const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Render will set the PORT environment variable.
// Defaulting to 10000 is a good practice for Render's free tier.
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

let waitingPlayer = null;
let gameRooms = {};

function handlePlayerLeave(socket) {
    console.log(`Handling departure for socket: ${socket.id}`);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
        waitingPlayer = null;
        console.log('The waiting player has left.');
    }
    for (const room in gameRooms) {
        if (gameRooms[room] && gameRooms[room].players.includes(socket.id)) {
            const opponentId = gameRooms[room].players.find(id => id !== socket.id);
            if (opponentId) {
                io.to(opponentId).emit('opponentDisconnected');
            }
            delete gameRooms[room];
            console.log(`Cleaned up room ${room} after player left.`);
            break;
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
        io.to(data.room).emit('moveMade', data.move);
    });

    socket.on('restartRequest', (data) => {
        io.to(data.room).emit('resetBoard');
    });
    
    socket.on('leaveGame', () => {
        handlePlayerLeave(socket);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected abruptly: ${socket.id}`);
        handlePlayerLeave(socket);
    });
});

// --- THIS IS THE FINAL, CORRECTED LINE FOR DEPLOYMENT ---
server.listen(PORT, '0.0.0.0', () => {
    // This log message is more accurate for a server environment
    console.log(`Server is listening on port ${PORT}`);
});
