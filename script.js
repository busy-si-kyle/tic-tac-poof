document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- DOM Elements ---
    const cells = document.querySelectorAll('.cell');
    const statusDisplay = document.getElementById('status-display');
    const timerDisplay = document.getElementById('timer-display');
    const restartButton = document.getElementById('restart-button');
    const themeToggleButton = document.getElementById('theme-toggle');
    const playerModeToggleButton = document.getElementById('player-mode-toggle');
    const multiplayerButton = document.getElementById('multiplayer-button');
    const difficultyControls = document.getElementById('difficulty-controls');
    const difficultyButtons = document.querySelectorAll('.difficulty-btn');
    const body = document.body;

    // --- Game State Variables ---
    let gameActive = true;
    let currentPlayer = 'X';
    let isTwoPlayerMode = true;
    let difficulty = 'easy';
    let gameState = ["", "", "", "", "", "", "", "", ""];
    let playerMoves = { 'X': [], 'O': [] };
    let removeSequenceStarted = false;
    let moveTimer = null;
    let isMultiplayerMode = false;
    let playerSymbol = null;
    let gameRoom = null;
    let aiMoveTimeout = null;

    const winningConditions = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    const winningMessage = () => `Player ${currentPlayer} has won!`;
    const currentPlayerTurn = () => `${currentPlayer}'s Turn`;

    // --- Event Listeners ---
    cells.forEach(cell => cell.addEventListener('click', handleCellClick));
    restartButton.addEventListener('click', handleRestartGame);
    themeToggleButton.addEventListener('click', toggleTheme);
    playerModeToggleButton.addEventListener('click', togglePlayerMode);
    difficultyButtons.forEach(button => button.addEventListener('click', handleDifficultyChange));
    multiplayerButton.addEventListener('click', findMultiplayerGame);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleRestartGame();
        }
    });

    // --- STATE MANAGEMENT ---
    function leaveMultiplayer() {
        stopMoveTimer();
        if (isMultiplayerMode) {
            socket.emit('leaveGame');
        }
        isMultiplayerMode = false;
        gameRoom = null;
        playerSymbol = null;
    }
    
    function setupNewGame(options) {
        leaveMultiplayer();
        isMultiplayerMode = options.isMultiplayer || false;
        isTwoPlayerMode = options.isTwoPlayer || false;
        if(options.difficulty) {
             difficulty = options.difficulty;
        }
        body.classList.toggle('two-player-mode', !isMultiplayerMode && isTwoPlayerMode);
        body.classList.toggle('single-player-mode', !isMultiplayerMode && !isTwoPlayerMode);
        internalRestart();
    }

    function togglePlayerMode() {
        setupNewGame({ isTwoPlayer: !isTwoPlayerMode });
    }

    function handleDifficultyChange(e) {
        const newDifficulty = e.target.getAttribute('data-difficulty');
        difficultyButtons.forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        setupNewGame({ isTwoPlayer: false, difficulty: newDifficulty });
    }

    // --- MODIFIED --- This now clears the board before looking for a game.
    function findMultiplayerGame() {
        leaveMultiplayer();
        
        // This is the key fix: Reset the entire game state and clear the board visually.
        internalRestart();

        // Now, set the UI to the "waiting" state.
        isMultiplayerMode = true;
        socket.emit('findGame');
        body.classList.remove('single-player-mode', 'two-player-mode');
        statusDisplay.innerHTML = "Looking for an opponent...";
        multiplayerButton.classList.add('waiting');
        disableBoard();
    }
    
    function handleRestartGame() {
        if (isMultiplayerMode) {
            socket.emit('restartRequest', { room: gameRoom });
        } else {
            internalRestart();
        }
    }

    function internalRestart() {
        if (aiMoveTimeout) {
            clearTimeout(aiMoveTimeout);
            aiMoveTimeout = null;
        }

        gameActive = true;
        currentPlayer = "X";
        gameState.fill("");
        playerMoves = { 'X': [], 'O': [] };
        removeSequenceStarted = false;
        
        cells.forEach(cell => {
            cell.innerHTML = "";
            cell.classList.remove('X', 'O');
        });
        
        enableBoard();
        multiplayerButton.classList.remove('waiting');
        stopMoveTimer();
        
        statusDisplay.innerHTML = "X's Turn";

        if (isMultiplayerMode) {
             if (playerSymbol) {
                statusDisplay.innerHTML = `You are ${playerSymbol}. It's ${currentPlayer}'s Turn.`;
            }
        } else if (!isTwoPlayerMode) {
            playerSymbol = Math.random() < 0.5 ? 'X' : 'O';
            console.log(`New Solo Game. You are player: ${playerSymbol}`);
            
            if (currentPlayer !== playerSymbol) {
                statusDisplay.innerHTML = `Computer's Turn (${currentPlayer})`;
                disableBoard();
                aiMoveTimeout = setTimeout(computerMove, 800);
            } else {
                statusDisplay.innerHTML = `Your Turn (${currentPlayer})`;
            }
        } else {
            playerSymbol = null;
        }
    }

    // --- CORE GAMEPLAY ---
    function handleCellClick(e) {
        const clickedCell = e.target;
        const clickedCellIndex = parseInt(clickedCell.getAttribute('data-index'));
        if (gameState[clickedCellIndex] !== "" || !gameActive) return;

        let isPlayersTurn = false;
        if (isMultiplayerMode) {
            isPlayersTurn = (currentPlayer === playerSymbol);
        } else if (!isTwoPlayerMode) {
            isPlayersTurn = (currentPlayer === playerSymbol);
        } else {
            isPlayersTurn = true;
        }

        if (!isPlayersTurn) return;
        
        if (isMultiplayerMode) {
            socket.emit('makeMove', { room: gameRoom, move: { index: clickedCellIndex, symbol: playerSymbol } });
        } else {
            makeMove(clickedCell, clickedCellIndex, currentPlayer);
            if (!checkWin()) {
                changePlayer();
            }
        }
    }
    
    function makeMove(cell, index, symbol) {
        stopMoveTimer(); 
        
        const playerToUpdate = symbol;
        gameState[index] = playerToUpdate;
        cell.innerHTML = playerToUpdate;
        cell.classList.add(playerToUpdate);
        playerMoves[playerToUpdate].push(index);

        if (!removeSequenceStarted && playerMoves['O'].length === 3) removeSequenceStarted = true;
        
        if (removeSequenceStarted) {
            const opponent = playerToUpdate === 'X' ? 'O' : 'X';
            if (playerMoves[opponent].length > 0) {
                const oldestMoveIndex = playerMoves[opponent].shift();
                gameState[oldestMoveIndex] = "";
                const oldestCell = document.querySelector(`[data-index='${oldestMoveIndex}']`);
                oldestCell.innerHTML = "";
                oldestCell.classList.remove('X', 'O');
                oldestCell.classList.add('fade-out');
                setTimeout(() => oldestCell.classList.remove('fade-out'), 500);
            }
        }
    }

    function checkWin() {
        let roundWon = false;
        let winningPlayer = null;
        for (const condition of winningConditions) {
            const [a, b, c] = condition;
            if (gameState[a] && gameState[a] === gameState[b] && gameState[a] === gameState[c]) {
                roundWon = true; winningPlayer = gameState[a]; break;
            }
        }
        if (roundWon) {
            let message;
            if (isMultiplayerMode) {
                 message = (winningPlayer === playerSymbol) ? "You have won!" : "You have lost!";
            } else if (!isTwoPlayerMode) {
                 message = (winningPlayer === playerSymbol) ? "You have won!" : "Computer has won!";
            } else {
                 message = `Player ${winningPlayer} has won!`;
            }
            statusDisplay.innerHTML = message;
            gameActive = false;
            stopMoveTimer();
            if (isMultiplayerMode) { socket.emit('gameEnded', { room: gameRoom }); }
        }
        return roundWon;
    }

    function changePlayer() {
        currentPlayer = currentPlayer === "X" ? "O" : "X";
        
        if (isMultiplayerMode) {
            statusDisplay.innerHTML = (currentPlayer === playerSymbol) ? "Your Turn" : `Opponent's Turn (${currentPlayer})`;
        } else if (!isTwoPlayerMode) {
            statusDisplay.innerHTML = (currentPlayer === playerSymbol) ? `Your Turn (${currentPlayer})` : `Computer's Turn (${currentPlayer})`;
            
            if (currentPlayer !== playerSymbol && gameActive) {
                disableBoard();
                aiMoveTimeout = setTimeout(computerMove, 700);
            } else {
                startMoveTimer();
            }
        } else {
            statusDisplay.innerHTML = currentPlayerTurn();
        }
    }

    // --- SOCKET.IO EVENT HANDLERS ---
    socket.on('waitingForOpponent', () => statusDisplay.innerHTML = "Waiting for an opponent...");
    socket.on('gameStart', (data) => { gameRoom = data.room; playerSymbol = data.symbol; isMultiplayerMode = true; internalRestart(); });
    socket.on('moveMade', (move) => { if (!isMultiplayerMode) return; const cell = document.querySelector(`[data-index='${move.index}']`); makeMove(cell, move.index, move.symbol); if (!checkWin()) changePlayer(); });
    socket.on('restartGame', (data) => { if (!isMultiplayerMode) return; playerSymbol = data.symbol; internalRestart(); });
    socket.on('opponentForfeited', () => { if (!isMultiplayerMode) return; statusDisplay.innerHTML = "Opponent forfeited. You win!"; gameActive = false; disableBoard(); });
    socket.on('youForfeited', () => { if (!isMultiplayerMode) return; statusDisplay.innerHTML = "You forfeited the match."; gameActive = false; disableBoard(); });
    socket.on('opponentDisconnected', () => { if (!isMultiplayerMode) return; gameActive = false; statusDisplay.innerHTML = "Opponent left. You win!"; leaveMultiplayer(); disableBoard(); });

    // --- AI LOGIC & HELPER FUNCTIONS ---
    function toggleTheme(){ body.classList.toggle('dark-mode'); themeToggleButton.querySelector('i').classList.toggle('fa-sun'); themeToggleButton.querySelector('i').classList.toggle('fa-moon'); }
    
    function startMoveTimer() {
        stopMoveTimer();
        if (!isTwoPlayerMode && difficulty === 'hard' && currentPlayer === playerSymbol && gameActive) {
            const isFirstMoveAsX = (playerSymbol === 'X' && playerMoves['X'].length === 0);
            
            if (!isFirstMoveAsX) {
                timerDisplay.classList.add('visible');
                let timeLeft = 3;
                timerDisplay.innerHTML = `Time left: ${timeLeft}`;
                moveTimer = setInterval(() => {
                    timeLeft--;
                    timerDisplay.innerHTML = `Time left: ${timeLeft}`;
                    if (timeLeft <= 0) {
                        stopMoveTimer();
                        gameActive = false;
                        statusDisplay.innerHTML = "Time's up! Computer wins!";
                        disableBoard();
                    }
                }, 1000);
            }
        }
    }

    function stopMoveTimer(){ clearInterval(moveTimer); moveTimer = null; if(timerDisplay) { timerDisplay.classList.remove('visible'); } }
    
    function computerMove(){
        const computerSymbol = (playerSymbol === 'X') ? 'O' : 'X';
        let moveIndex; 
        if (difficulty === 'hard') {
            moveIndex = getHardMove(computerSymbol, playerSymbol);
        } else if (difficulty === 'medium') {
            moveIndex = getMediumMove(computerSymbol, playerSymbol);
        } else {
            moveIndex = getEasyMove(computerSymbol, playerSymbol);
        }
        if (moveIndex !== null && gameActive) {
            const cellToPlay = document.querySelector(`[data-index='${moveIndex}']`);
            makeMove(cellToPlay, moveIndex, computerSymbol);
            if (!checkWin()) {
                changePlayer();
            }
        }
        enableBoard();
    }
    
    function getEasyMove(mySymbol, opponentSymbol){ const availableCells = getAvailableCells(gameState); if (Math.random() < 0.33) { const blockMove = findWinningOrBlockingMove(gameState, opponentSymbol); if (blockMove !== null) return blockMove; } return availableCells[Math.floor(Math.random() * availableCells.length)]; }
    function getMediumMove(mySymbol, opponentSymbol){ const winMove = findWinningOrBlockingMove(gameState, mySymbol); if (winMove !== null) return winMove; const blockMove = findWinningOrBlockingMove(gameState, opponentSymbol); if (blockMove !== null) return blockMove; if (gameState[4] === "") return 4; const availableCells = getAvailableCells(gameState); return availableCells[Math.floor(Math.random() * availableCells.length)]; }
    function getHardMove(mySymbol, opponentSymbol){ let move = findWinningOrBlockingMove(gameState, mySymbol); if (move !== null) return move; if (playerMoves[opponentSymbol].length === 3) { const oldestPlayerMove = playerMoves[opponentSymbol][0]; const blockableThreat = findValidThreats(gameState, opponentSymbol, oldestPlayerMove); if (blockableThreat !== null) { return blockableThreat; } const boardAfterRemoval = [...gameState]; boardAfterRemoval[oldestPlayerMove] = ''; const strategicWin = findWinningOrBlockingMove(boardAfterRemoval, mySymbol); if (strategicWin !== null && gameState[strategicWin] === '') { return strategicWin; } } move = findWinningOrBlockingMove(gameState, opponentSymbol); if (move !== null) return move; if (gameState[4] === "") return 4; const availableCells = getAvailableCells(gameState); return availableCells.length > 0 ? availableCells[Math.floor(Math.random() * availableCells.length)] : null; }
    function findValidThreats(board, player, oldestMoveIndex){ for (const condition of winningConditions) { const [a, b, c] = condition; const line = [board[a], board[b], board[c]]; if (line.filter(p => p === player).length === 2 && line.includes("")) { if (condition.includes(oldestMoveIndex)) { continue; } else { return condition[line.indexOf("")]; } } } return null; }
    function findWinningOrBlockingMove(board, player){ for (const condition of winningConditions) { const [a, b, c] = condition; const line = [board[a], board[b], board[c]]; const emptyIndex = [a, b, c][line.indexOf("")]; if (line.filter(p => p === player).length === 2 && line.includes("")) { return emptyIndex; } } return null; }
    function getAvailableCells(board){ return board.map((val, index) => val === "" ? index : null).filter(val => val !== null); }
    function disableBoard(){ document.getElementById('game-grid').style.pointerEvents = 'none'; }
    function enableBoard(){ document.getElementById('game-grid').style.pointerEvents = 'auto'; }

    // --- INITIAL GAME SETUP ---
    setupNewGame({ isTwoPlayer: true });
});
