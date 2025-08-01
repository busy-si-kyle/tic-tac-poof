const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const TURN_DURATION_MS = 3000;

// --- NEW --- Add server-side constants for game logic
const winningConditions = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let waitingPlayer = null;
let gameRooms = {};

function broadcastPlayerCount() {
    const playerCount = io.sockets.sockets.size;
    io.emit('updatePlayerCount', playerCount);
}

// --- NEW --- Server-side function to check for a winner
function checkServerWin(board) {
    for (const condition of winningConditions) {
        const [a, b, c] = condition;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return true;
        }
    }
    return false;
}

function clearRoomTimer(room) {
    if (gameRooms[room] && gameRooms[room].timerId) {
        clearTimeout(gameRooms[room].timerId);
        gameRooms[room].timerId = null;
    }
}

function startNewTurn(room) {
    clearRoomTimer(room);
    const roomData = gameRooms[room];
    if (!roomData || !roomData.gameActive) return;

    roomData.turnCount++;
    const currentPlayerIndex = roomData.players.indexOf(roomData.currentPlayer);
    const nextPlayerIndex = (currentPlayerIndex + 1) % 2;
    roomData.currentPlayer = roomData.players[nextPlayerIndex];
    const currentPlayerSymbol = (nextPlayerIndex === 0) ? 'X' : 'O';

    io.to(room).emit('newTurn', {
        currentPlayerId: roomData.currentPlayer,
        symbol: currentPlayerSymbol
    });

    if (roomData.turnCount > 1) {
        io.to(roomData.currentPlayer).emit('startTimer', { duration: TURN_DURATION_MS });
        roomData.timerId = setTimeout(() => {
            handleGameOver(room, 'timeout');
        }, TURN_DURATION_MS);
    }
}

function handleGameOver(room, reason) {
    const roomData = gameRooms[room];
    if (!roomData || !roomData.gameActive) return;

    roomData.gameActive = false;
    clearRoomTimer(room);

    let winnerId, loserId;

    if (reason === 'timeout') {
        loserId = roomData.currentPlayer;
        winnerId = roomData.players.find(id => id !== loserId);
        console.log(`Timeout in room ${room}. Winner: ${winnerId}`);
    } else if (reason === 'forfeit') {
        loserId = roomData.lastActionBy;
        winnerId = roomData.players.find(id => id !== loserId);
        console.log(`Forfeit in room ${room}. Winner: ${winnerId}`);
    } else if (reason === 'disconnect') {
        loserId = roomData.lastActionBy;
        winnerId = roomData.players.find(id => id !== loserId);
        console.log(`Disconnect in room ${room}. Winner: ${winnerId}`);
    } else { // Natural win
        winnerId = roomData.lastActionBy;
        loserId = roomData.players.find(id => id !== winnerId);
    }

    io.to(room).emit('gameOver', { winnerId, loserId, reason });
}

function handlePlayerLeave(socket) {
    for (const room in gameRooms) {
        if (gameRooms[room] && gameRooms[room].players.includes(socket.id)) {
            gameRooms[room].lastActionBy = socket.id;
            handleGameOver(room, 'disconnect');
            delete gameRooms[room];
            console.log(`Cleaned up room ${room} after player disconnected.`);
            break;
        }
    }
    if (waitingPlayer && waitingPlayer.id === socket.id) {
        waitingPlayer = null;
    }
    broadcastPlayerCount();
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    broadcastPlayerCount();

    socket.on('findGame', () => {
        if (waitingPlayer) {
            const room = `room_${socket.id}_${waitingPlayer.id}`;
            const playerX = waitingPlayer.id;
            const playerO = socket.id;
            waitingPlayer.join(room);
            socket.join(room);

            gameRooms[room] = {
                players: [playerX, playerO],
                gameState: ["", "", "", "", "", "", "", "", ""], // MODIFIED: Add gameState
                gameActive: true,
                currentPlayer: playerX,
                timerId: null,
                turnCount: 1,
                lastActionBy: null
            };

            io.to(playerX).emit('gameStart', { symbol: 'X', room: room });
            io.to(playerO).emit('gameStart', { symbol: 'O', room: room });
            io.to(room).emit('newTurn', { currentPlayerId: playerX, symbol: 'X' });

            console.log(`Game started in room ${room}`);
            waitingPlayer = null;
        } else {
            waitingPlayer = socket;
            io.to(socket.id).emit('waitingForOpponent');
        }
    });

    // --- MODIFIED --- This is the core of the fix.
    socket.on('makeMove', (data) => {
        const roomData = gameRooms[data.room];
        if (roomData && roomData.gameActive && roomData.currentPlayer === socket.id) {
            roomData.lastActionBy = socket.id;

            // Server updates its own game state
            const { index, symbol } = data.move;
            roomData.gameState[index] = symbol;

            // Broadcast the move to clients so they can render it
            io.to(data.room).emit('moveMade', data.move);

            // Server checks for the win condition
            if (checkServerWin(roomData.gameState)) {
                handleGameOver(data.room, 'win');
            } else {
                startNewTurn(data.room);
            }
        }
    });

    // --- REMOVED --- The 'gameEnded' listener is no longer necessary.
    // socket.on('gameEnded', ...);

    socket.on('restartRequest', (data) => {
        const room = data.room;
        const roomData = gameRooms[room];
        if (!roomData || roomData.players.length !== 2) return;

        clearRoomTimer(room);
        roomData.lastActionBy = socket.id;

        if (roomData.gameActive) {
            handleGameOver(room, 'forfeit');
        } else {
            console.log(`Restarting new round for room ${room}.`);
            let players = roomData.players;
            if (Math.random() < 0.5) {
                [players[0], players[1]] = [players[1], players[0]];
            }
            roomData.players = players;
            // MODIFIED: Reset the server's game state
            roomData.gameState = ["", "", "", "", "", "", "", "", ""];
            roomData.gameActive = true;
            roomData.currentPlayer = players[0];
            roomData.turnCount = 1;

            io.to(players[0]).emit('restartGame', { symbol: 'X' });
            io.to(players[1]).emit('restartGame', { symbol: 'O' });
            io.to(room).emit('newTurn', { currentPlayerId: players[0], symbol: 'X' });
        }
    });

    socket.on('leaveGame', () => { handlePlayerLeave(socket); });
    socket.on('disconnect', () => { console.log(`User disconnected abruptly: ${socket.id}`); handlePlayerLeave(socket); });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is listening on port ${PORT}`);
});
