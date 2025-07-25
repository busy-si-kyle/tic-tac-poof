const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
                // Mark room as closed so no further actions can be taken
                gameRooms[room].closed = true;
                io.to(opponentId).emit('roomClosed');
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
            gameRooms[room] = { players: [waitingPlayer.id, socket.id], gameActive: true };
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
        if (gameRooms[data.room]) {
            gameRooms[data.room].gameActive = true;
        }
        io.to(data.room).emit('moveMade', data.move);
    });

    // --- NEW: Multiplayer timeout event ---
    socket.on('multiplayerTimeout', (data) => {
        const room = data.room;
        if (!gameRooms[room] || !gameRooms[room].gameActive) return;
        gameRooms[room].gameActive = false;
        const players = gameRooms[room].players;
        const loser = socket.id;
        const winner = players.find(id => id !== loser);
        io.to(room).emit('multiplayerTimeout', { loser, winner });
    });

    socket.on('gameEnded', (data) => {
        if (gameRooms[data.room]) {
            console.log(`Game ended naturally in room ${data.room}`);
            gameRooms[data.room].gameActive = false;
        }
    });

    // --- MODIFIED --- This logic is now split into two distinct states.
    socket.on('restartRequest', (data) => {
        const room = data.room;
        if (!gameRooms[room] || gameRooms[room].players.length !== 2) return;
        // Prevent restart if room is closed
        if (gameRooms[room].closed) {
            io.to(socket.id).emit('roomClosed');
            return;
        }
        // --- STATE 1: FORFEIT ---
        // If the game is active, this request is a FORFEIT.
        if (gameRooms[room].gameActive) {
            const players = gameRooms[room].players;
            const requestingPlayerId = socket.id;
            const opponentId = players.find(id => id !== requestingPlayerId);

            console.log(`Player ${requestingPlayerId} forfeited in room ${room}.`);
            // Set the game to inactive so this block isn't triggered again.
            gameRooms[room].gameActive = false;

            // Tell the players the result. THE GAME STOPS HERE.
            io.to(opponentId).emit('opponentForfeited');
            io.to(requestingPlayerId).emit('youForfeited');

        // --- STATE 2: PLAY AGAIN ---
        // If the game is NOT active, this request is to PLAY AGAIN.
        } else {
            console.log(`Restarting new round for room ${room}.`);
            let players = gameRooms[room].players;

            if (Math.random() < 0.5) {
                [players[0], players[1]] = [players[1], players[0]];
            }
            gameRooms[room].players = players;
            gameRooms[room].gameActive = true; // New game is now active.

            const playerX_id = players[0];
            const playerO_id = players[1];

            io.to(playerX_id).emit('restartGame', { symbol: 'X' });
            io.to(playerO_id).emit('restartGame', { symbol: 'O' });
        }
    });
    
    socket.on('leaveGame', () => {
        handlePlayerLeave(socket);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected abruptly: ${socket.id}`);
        handlePlayerLeave(socket);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});
