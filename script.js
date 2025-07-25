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
    const difficultySlider = document.querySelector('.difficulty-slider');
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
    let multiplayerMoveTimer = null;
    let multiplayerTimerActive = false;

    const winningConditions = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    // --- Event Listeners ---
    cells.forEach(cell => cell.addEventListener('click', handleCellClick));
    restartButton.addEventListener('click', handleRestartGame);
    themeToggleButton.addEventListener('click', toggleTheme);
    playerModeToggleButton.addEventListener('click', togglePlayerMode);
    difficultyButtons.forEach(button => button.addEventListener('click', handleDifficultyChange));
    multiplayerButton.addEventListener('click', findMultiplayerGame);
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleRestartGame(); });
    window.addEventListener('resize', updateSliderPosition);

    // --- Slider Logic ---
    function updateSliderPosition() {
        const activeButton = document.querySelector('.difficulty-btn.active');
        if (activeButton) {
            const width = activeButton.offsetWidth;
            const position = activeButton.offsetLeft;
            difficultySlider.style.width = `${width}px`;
            difficultySlider.style.transform = `translateX(${position}px)`;
        }
    }

    function handleDifficultyChange(e) {
        const newDifficulty = e.target.getAttribute('data-difficulty');
        difficultyButtons.forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        updateSliderPosition();
        setupNewGame({ isTwoPlayer: false, difficulty: newDifficulty });
    }

    // --- State Management & Game Flow ---
    function leaveMultiplayer() { if (isMultiplayerMode) { socket.emit('leaveGame'); } isMultiplayerMode = false; gameRoom = null; playerSymbol = null; }
    function updatePlayerModeIcon() { body.classList.toggle('two-player-mode', isTwoPlayerMode); body.classList.toggle('single-player-mode', !isTwoPlayerMode); }
    
    // --- MODIFIED to fix slider visibility bug ---
    function setupNewGame(options) {
        leaveMultiplayer();
        isMultiplayerMode = options.isMultiplayer || false;
        isTwoPlayerMode = options.isTwoPlayer || false;
        if(options.difficulty) {
             difficulty = options.difficulty;
        }
        updatePlayerModeIcon();

        // --- NEW --- If switching to single-player, update the slider's position.
        if (!isTwoPlayerMode) {
            // Use a minimal timeout to ensure the browser has rendered the element
            // before we try to measure its position. This fixes the visibility bug.
            setTimeout(updateSliderPosition, 0);
        }

        internalRestart();
    }

    function togglePlayerMode() { setupNewGame({ isTwoPlayer: !isTwoPlayerMode }); }
    function findMultiplayerGame() { leaveMultiplayer(); isMultiplayerMode = true; socket.emit('findGame'); body.classList.remove('single-player-mode', 'two-player-mode'); updatePlayerModeIcon(); statusDisplay.innerHTML = "Looking for an opponent..."; multiplayerButton.classList.add('waiting'); disableBoard(); }
    function handleRestartGame() { if (isMultiplayerMode) { socket.emit('restartRequest', { room: gameRoom }); } else { internalRestart(); } }
    
    function internalRestart() {
        if (aiMoveTimeout) { clearTimeout(aiMoveTimeout); aiMoveTimeout = null; }
        stopMultiplayerMoveTimer();
        gameActive = true;
        currentPlayer = "X";
        gameState.fill("");
        playerMoves = { 'X': [], 'O': [] };
        removeSequenceStarted = false;
        cells.forEach(cell => { cell.innerHTML = ""; cell.classList.remove('X', 'O'); });
        enableBoard();
        multiplayerButton.classList.remove('waiting');
        stopMoveTimer();
        if (isMultiplayerMode) {
            if (playerSymbol) { statusDisplay.innerHTML = `You are ${playerSymbol}. It's ${currentPlayer}'s Turn.`; }
        } else {
            statusDisplay.innerHTML = `${currentPlayer}'s Turn`;
            if (!isTwoPlayerMode) startMoveTimer();
        }
    }

    // --- Core Gameplay Logic ---
    function handleCellClick(e) {
        const clickedCell = e.target;
        const clickedCellIndex = parseInt(clickedCell.getAttribute('data-index'));
        if (gameState[clickedCellIndex] !== "" || !gameActive) return;
        if (isMultiplayerMode) {
            if (currentPlayer === playerSymbol) {
                socket.emit('makeMove', { room: gameRoom, move: { index: clickedCellIndex, symbol: playerSymbol } });
                stopMultiplayerMoveTimer();
            }
            return;
        }
        stopMoveTimer();
        makeMove(clickedCell, clickedCellIndex);
        if (!checkWin()) {
            changePlayer();
            if (!isTwoPlayerMode && currentPlayer === 'O' && gameActive) {
                disableBoard();
                aiMoveTimeout = setTimeout(computerMove, 700);
            }
        }
    }

    function makeMove(cell, index, symbol = null) {
        const playerToUpdate = symbol || currentPlayer;
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
                roundWon = true;
                winningPlayer = gameState[a];
                break;
            }
        }
        if (roundWon) {
            statusDisplay.innerHTML = `Player ${winningPlayer} has won!`;
            gameActive = false;
            stopMoveTimer();
            if (isMultiplayerMode) {
                socket.emit('gameEnded', { room: gameRoom });
            }
        }
        return roundWon;
    }

    function changePlayer() {
        currentPlayer = currentPlayer === "X" ? "O" : "X";
        if (isMultiplayerMode) {
            statusDisplay.innerHTML = (currentPlayer === playerSymbol) ? "Your Turn" : `Opponent's Turn (${currentPlayer})`;
            if (gameActive && currentPlayer === playerSymbol && ((currentPlayer === 'O' && playerMoves['O'].length === 0) || (playerMoves[currentPlayer].length > 0))) {
                startMultiplayerMoveTimer();
            } else {
                stopMultiplayerMoveTimer();
            }
        } else {
            statusDisplay.innerHTML = `${currentPlayer}'s Turn`;
        }
        if (!isMultiplayerMode) startMoveTimer();
    }

    // --- Timer Functions ---
    function startMultiplayerMoveTimer() {
        stopMultiplayerMoveTimer();
        multiplayerTimerActive = true;
        let timeLeft = 3;
        timerDisplay.classList.add('visible');
        timerDisplay.innerHTML = `Time left: ${timeLeft}`;
        multiplayerMoveTimer = setInterval(() => {
            timeLeft--;
            timerDisplay.innerHTML = `Time left: ${timeLeft}`;
            if (timeLeft <= 0) {
                stopMultiplayerMoveTimer();
                multiplayerTimerActive = false;
                gameActive = false;
                if (currentPlayer === playerSymbol) {
                    statusDisplay.innerHTML = "You lost on time. Opponent wins!";
                    socket.emit('multiplayerTimeout', { room: gameRoom });
                } else {
                    statusDisplay.innerHTML = "Opponent lost on time. You win!";
                }
                disableBoard();
            }
        }, 1000);
    }

    function stopMultiplayerMoveTimer() {
        clearInterval(multiplayerMoveTimer);
        multiplayerMoveTimer = null;
        multiplayerTimerActive = false;
        if (timerDisplay) timerDisplay.classList.remove('visible');
    }

    // --- Socket.IO Event Handlers ---
    socket.on('waitingForOpponent', () => statusDisplay.innerHTML = "Waiting for an opponent...");
    socket.on('gameStart', (data) => { gameRoom = data.room; playerSymbol = data.symbol; isMultiplayerMode = true; internalRestart(); });
    socket.on('moveMade', (move) => { if (!isMultiplayerMode) return; const cell = document.querySelector(`[data-index='${move.index}']`); makeMove(cell, move.index, move.symbol); if (!checkWin()) changePlayer(); });
    socket.on('restartGame', (data) => { if (!isMultiplayerMode) return; playerSymbol = data.symbol; internalRestart(); });
    socket.on('multiplayerTimeout', (data) => { if (!isMultiplayerMode) return; stopMultiplayerMoveTimer(); gameActive = false; if (socket.id === data.loser) { statusDisplay.innerHTML = "You lost on time. Opponent wins!"; } else if (socket.id === data.winner) { statusDisplay.innerHTML = "Opponent lost on time. You win!"; } else { statusDisplay.innerHTML = "Game ended due to timeout."; } disableBoard(); });
    socket.on('opponentForfeited', () => { if (!isMultiplayerMode) return; stopMultiplayerMoveTimer(); statusDisplay.innerHTML = "Opponent quit. You win!"; gameActive = false; disableBoard(); });
    socket.on('youForfeited', () => { if (!isMultiplayerMode) return; stopMultiplayerMoveTimer(); statusDisplay.innerHTML = "You quit. Opponent wins!"; gameActive = false; disableBoard(); });
    socket.on('opponentDisconnected', () => { if (!isMultiplayerMode) return; stopMultiplayerMoveTimer(); gameActive = false; statusDisplay.innerHTML = "Opponent left. You win!"; leaveMultiplayer(); disableBoard(); });
    socket.on('roomClosed', () => { if (!isMultiplayerMode) return; stopMultiplayerMoveTimer(); statusDisplay.innerHTML = "Room closed. Opponent left. Please start a new game."; gameActive = false; disableBoard(); leaveMultiplayer(); });

    // --- AI and Untouched Original Functions ---
    function toggleTheme(){ body.classList.toggle('dark-mode'); themeToggleButton.querySelector('i').classList.toggle('fa-sun'); themeToggleButton.querySelector('i').classList.toggle('fa-moon'); }
    function startMoveTimer(){ stopMoveTimer(); if (!isTwoPlayerMode && difficulty === 'hard' && currentPlayer === 'X' && gameActive && playerMoves['X'].length > 0) { timerDisplay.classList.add('visible'); let timeLeft = 3; timerDisplay.innerHTML = `Time left: ${timeLeft}`; moveTimer = setInterval(() => { timeLeft--; timerDisplay.innerHTML = `Time left: ${timeLeft}`; if (timeLeft <= 0) { stopMoveTimer(); gameActive = false; statusDisplay.innerHTML = "Time's up! O wins!"; disableBoard(); } }, 1000); } }
    function stopMoveTimer(){ clearInterval(moveTimer); moveTimer = null; if(timerDisplay) { timerDisplay.classList.remove('visible'); } }
    function computerMove(){ let moveIndex; if (difficulty === 'hard') { moveIndex = getHardMove(); } else if (difficulty === 'medium') { moveIndex = getMediumMove(); } else { moveIndex = getEasyMove(); } if (moveIndex !== null && gameActive) { const cellToPlay = document.querySelector(`[data-index='${moveIndex}']`); makeMove(cellToPlay, moveIndex); if (!checkWin()) { changePlayer(); } } enableBoard(); }
    function getEasyMove(){ const availableCells = getAvailableCells(gameState); if (Math.random() < 0.33) { const blockMove = findWinningOrBlockingMove(gameState, 'X'); if (blockMove !== null) return blockMove; } return availableCells[Math.floor(Math.random() * availableCells.length)]; }
    function getMediumMove(){ const winMove = findWinningOrBlockingMove(gameState, 'O'); if (winMove !== null) return winMove; const blockMove = findWinningOrBlockingMove(gameState, 'X'); if (blockMove !== null) return blockMove; if (gameState[4] === "") return 4; const availableCells = getAvailableCells(gameState); return availableCells[Math.floor(Math.random() * availableCells.length)]; }
    function getHardMove(){ let move = findWinningOrBlockingMove(gameState, 'O'); if (move !== null) return move; if (playerMoves['X'].length === 3) { const oldestPlayerMove = playerMoves['X'][0]; const blockableThreat = findValidThreats(gameState, 'X', oldestPlayerMove); if (blockableThreat !== null) { return blockableThreat; } const boardAfterRemoval = [...gameState]; boardAfterRemoval[oldestPlayerMove] = ''; const strategicWin = findWinningOrBlockingMove(boardAfterRemoval, 'O'); if (strategicWin !== null && gameState[strategicWin] === '') { return strategicWin; } } move = findWinningOrBlockingMove(gameState, 'X'); if (move !== null) return move; if (gameState[4] === "") return 4; const availableCells = getAvailableCells(gameState); return availableCells.length > 0 ? availableCells[Math.floor(Math.random() * availableCells.length)] : null; }
    function findValidThreats(board, player, oldestMoveIndex){ for (const condition of winningConditions) { const [a, b, c] = condition; const line = [board[a], board[b], board[c]]; if (line.filter(p => p === player).length === 2 && line.includes("")) { if (condition.includes(oldestMoveIndex)) { continue; } else { return condition[line.indexOf("")]; } } } return null; }
    function findWinningOrBlockingMove(board, player){ for (const condition of winningConditions) { const [a, b, c] = condition; const line = [board[a], board[b], board[c]]; const emptyIndex = [a, b, c][line.indexOf("")]; if (line.filter(p => p === player).length === 2 && line.includes("")) { return emptyIndex; } } return null; }
    function getAvailableCells(board){ return board.map((val, index) => val === "" ? index : null).filter(val => val !== null); }
    function disableBoard(){ document.getElementById('game-grid').style.pointerEvents = 'none'; }
    function enableBoard(){ document.getElementById('game-grid').style.pointerEvents = 'auto'; }

    // --- Initial Game Setup ---
    setupNewGame({ isTwoPlayer: true });
    updateSliderPosition(); // Set initial slider position on page load

});
