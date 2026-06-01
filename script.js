document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DOM要素の取得 ---
    const screens = { menu: document.getElementById('menu-screen'), game: document.getElementById('game-screen') };
    const overlays = { result: document.getElementById('result-screen'), pause: document.getElementById('pause-overlay') };
    const boardCanvas = document.getElementById('game-board');
    const holdCanvas = document.getElementById('hold-canvas');
    const nextCanvases = [1, 2, 3, 4, 5].map(i => document.getElementById(`next-canvas-${i}`));

    const ctx = boardCanvas.getContext('2d');
    const holdCtx = holdCanvas.getContext('2d');
    const nextCtxs = nextCanvases.map(c => c.getContext('2d'));

    const displays = {
        score: document.getElementById('score-display'), lines: document.getElementById('lines-display'),
        level: document.getElementById('level-display'), time: document.getElementById('time-display')
    };

    // --- 2. ゲーム定数 ---
    const COLS = 10, ROWS = 20;
    let BLOCK_SIZE = 30;

    const COLORS = {
        'I': '#00f0f0', 'J': '#0000f0', 'L': '#f0a000', 'O': '#f0f000',
        'S': '#00f000', 'T': '#a000f0', 'Z': '#f00000'
    };

    const BIG_BANG_THEMES = [
        { name: 'CLASSIC', color: '#555555' }, { name: 'STAIRS', color: '#009688' },
        { name: 'CANYON', color: '#e53935' }, { name: 'ZIGZAG', color: '#9c27b0' }, { name: 'CHAOS', color: '#ffb300' }
    ];

    const SHAPES = {
        'I': [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], 'J': [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
        'L': [[0, 0, 1], [1, 1, 1], [0, 0, 0]], 'O': [[1, 1], [1, 1]], 'S': [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
        'T': [[0, 1, 0], [1, 1, 1], [0, 0, 0]], 'Z': [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
    };

  // 【重要修正】SRS (Super Rotation System) の壁蹴りデータ (+Yは下方向のCanvas座標系に完全準拠)
    const KICK_DATA = {
        'JLSTZ': {
            '0_1': [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
            '1_0': [[0,0], [1,0], [1,1], [0,-2], [1,-2]],
            '1_2': [[0,0], [1,0], [1,1], [0,-2], [1,-2]],
            '2_1': [[0,0], [-1,0], [-1,-1], [0,2], [-1,2]],
            '2_3': [[0,0], [1,0], [1,-1], [0,2], [1,2]],
            '3_2': [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
            '3_0': [[0,0], [-1,0], [-1,1], [0,-2], [-1,-2]],
            '0_3': [[0,0], [1,0], [1,-1], [0,2], [1,2]]
        },
        'I': {
            '0_1': [[0,0], [-2,0], [1,0], [-2,1], [1,-2]],
            '1_0': [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],
            '1_2': [[0,0], [-1,0], [2,0], [-1,-2], [2,1]],
            '2_1': [[0,0], [1,0], [-2,0], [1,2], [-2,-1]],
            '2_3': [[0,0], [2,0], [-1,0], [2,-1], [-1,2]],
            '3_2': [[0,0], [-2,0], [1,0], [-2,1], [1,-2]],
            '3_0': [[0,0], [1,0], [-2,0], [1,2], [-2,-1]],
            '0_3': [[0,0], [-1,0], [2,0], [-1,-2], [2,1]]
        }
    };

    // --- 3. 状態管理変数 ---
    let grid, currentPiece, nextPieces, holdPiece, canHold;
    let score, lines, level, dropCounter, dropInterval, isGameOver, isPaused, gameMode;
    let timer, timerInterval, bigBangStage, lastTime, animationId;
    let isTimeUp = false;
    let lockDelayTimer = 0, lockResets = 0;

    let moveMultiplier = 1; 
    let lastActionTime = 0; 

    function resizeCanvas() {
        BLOCK_SIZE = window.innerWidth <= 768 ? 20 : 30;
        boardCanvas.width = BLOCK_SIZE * COLS;
        boardCanvas.height = BLOCK_SIZE * ROWS;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- 4. コアロジック ---

    function createEmptyGrid() { return Array.from({ length: ROWS }, () => Array(COLS).fill(0)); }

    function spawnPiece() {
        if (nextPieces.length < 10) {
            const types = gameMode === 'BIG_BANG' ? Array(7).fill('I') : Object.keys(SHAPES);
            nextPieces.push(...types.sort(() => Math.random() - 0.5));
        }
        const type = nextPieces.shift();
        currentPiece = {
            type, matrix: SHAPES[type], rotation: 0, // 初期回転状態は0
            x: Math.floor(COLS / 2) - Math.floor(SHAPES[type][0].length / 2),
            y: type === 'I' ? -1 : 0
        };
        canHold = true; lockDelayTimer = 0; lockResets = 0;

        if (gameMode === '20G') while (isValid(currentPiece, 0, 1)) currentPiece.y++;

        if (!isValid(currentPiece)) {
            const canSurvive = isValid(currentPiece, -1, 0) || isValid(currentPiece, 1, 0) || isValid({ ...currentPiece, matrix: getRotatedMatrix(currentPiece.matrix, 1) });
            if (!canSurvive || gameMode !== '20G') isGameOver = true;
        }
    }

    function isValid(piece, ox = 0, oy = 0, matrix = piece.matrix) {
        return matrix.every((row, y) => row.every((val, x) => {
            if (!val) return true;
            let nx = piece.x + x + ox, ny = piece.y + y + oy;
            return (nx >= 0 && nx < COLS && ny < ROWS && (ny < 0 || grid[ny][nx] === 0));
        }));
    }

    function getRotatedMatrix(m, dir) {
        const n = m.length;
        if (dir === 1) return m.map((row, i) => row.map((_, j) => m[n - 1 - j][i])); 
        if (dir === -1) return m.map((row, i) => row.map((_, j) => m[j][n - 1 - i])); 
        if (dir === 2) return m.map(row => [...row].reverse()).reverse(); 
        return m;
    }

    // 【重要】SRS対応の完璧な回転ロジック
    function rotate(dir) {
        if (isPaused || isGameOver || currentPiece.type === 'O') return;
        const now = Date.now();
        if (now - lastActionTime < 50) return;
        lastActionTime = now;

        const nextMatrix = getRotatedMatrix(currentPiece.matrix, dir);
        let nextRotation = currentPiece.rotation;
        let kicks = [[0,0]];

        if (dir === 1 || dir === -1) {
            nextRotation = (currentPiece.rotation + (dir === 1 ? 1 : 3)) % 4;
            const kickKey = `${currentPiece.rotation}_${nextRotation}`;
            const table = currentPiece.type === 'I' ? KICK_DATA['I'] : KICK_DATA['JLSTZ'];
            kicks = table[kickKey] || [[0,0]];
        } else if (dir === 2) {
            nextRotation = (currentPiece.rotation + 2) % 4;
            kicks = [[0,0], [0,1], [1,1], [-1,1], [0,-1]]; // 180度回転用の簡易キック
        }

        // T-Spin等が可能になるよう、すべてのキックパターンを順番に試す
        for (const [kx, ky] of kicks) {
            if (isValid(currentPiece, kx, ky, nextMatrix)) {
                currentPiece.x += kx; 
                currentPiece.y += ky;
                currentPiece.matrix = nextMatrix;
                currentPiece.rotation = nextRotation; // 回転状態の更新
                resetLockDelay(); 
                return;
            }
        }
    }

    function move(dx) {
        if (isPaused || isGameOver) return;
        const now = Date.now();
        if (now - lastActionTime < 80) return; 
        lastActionTime = now;

        let moved = 0;
        while (moved < moveMultiplier && isValid(currentPiece, dx, 0)) {
            currentPiece.x += dx;
            moved++;
        }
        if (moved > 0) resetLockDelay();
    }

    function moveToCenter() {
        if (isPaused || isGameOver) return;
        const now = Date.now();
        if (now - lastActionTime < 80) return; 
        lastActionTime = now;

        const targetX = Math.floor(COLS / 2) - Math.floor(currentPiece.matrix[0].length / 2);
        if (currentPiece.x === targetX) return; 

        const step = targetX > currentPiece.x ? 1 : -1; 
        let moved = false;

        while (currentPiece.x !== targetX && isValid(currentPiece, step, 0)) {
            currentPiece.x += step;
            moved = true;
        }
        
        if (moved) resetLockDelay();
    }

    // 【追加】端へ一気に移動する処理
    function moveToEdge(dir) {
        if (isPaused || isGameOver) return;
        const now = Date.now();
        if (now - lastActionTime < 80) return; 
        lastActionTime = now;

        let moved = false;
        while (isValid(currentPiece, dir, 0)) {
            currentPiece.x += dir;
            moved = true;
        }
        if (moved) resetLockDelay();
    }

    function softDrop() {
        if (isPaused || isGameOver) return;
        let moved = 0;
        while (moved < moveMultiplier && isValid(currentPiece, 0, 1)) {
            currentPiece.y++;
            moved++;
        }
        if (moved > 0) dropCounter = 0;
        else if (lockDelayTimer >= 500 || gameMode !== '20G') lockPiece();
    }

    function hardDrop() {
        if (isPaused || isGameOver) return;
        while (isValid(currentPiece, 0, 1)) currentPiece.y++;
        lockPiece();
    }

    function resetLockDelay() { if (lockResets < 15) { lockDelayTimer = 0; lockResets++; } }

    function lockPiece() {
        currentPiece.matrix.forEach((row, y) => row.forEach((val, x) => {
            if (val) {
                if (currentPiece.y + y < 0) isGameOver = true;
                else grid[currentPiece.y + y][currentPiece.x + x] = currentPiece.type;
            }
        }));
        clearLines();
        if (!isGameOver) spawnPiece();
    }

    function clearLines() {
        let cleared = 0;
        for (let y = ROWS - 1; y >= 0; y--) {
            if (grid[y].every(cell => cell !== 0)) {
                grid.splice(y, 1);
                grid.unshift(Array(COLS).fill(0));
                cleared++;
                y++; 
            }
        }

        if (cleared > 0) {
            lines += cleared;
            score += [0, 100, 300, 500, 800][cleared] * level;
            if (gameMode === 'NORMAL') {
                level = Math.floor(lines / 10) + 1;
                dropInterval = Math.max(100, 1000 - (level - 1) * 50);
            }
            if (gameMode === '40_LINES' && lines >= 40) isGameOver = true;
        }

        if (gameMode === 'BIG_BANG') {
            const hasPuzzle = grid.some(row => row.some(cell => typeof cell === 'string' && cell.startsWith('PUZZLE_')));
            if (!hasPuzzle) {
                grid = createEmptyGrid();
                bigBangStage++;
                if (bigBangStage > 5) {
                    isGameOver = true; 
                } else {
                    generateBigBangPuzzle(); 
                }
            }
        }
    }

    function generateBigBangPuzzle() {
        grid = createEmptyGrid();
        const theme = BIG_BANG_THEMES[(bigBangStage - 1) % 5];
        for (let y = ROWS - 1; y >= ROWS - 8; y--) {
            for (let x = 0; x < COLS; x++) {
                let place = false;
                if (theme.name === 'CLASSIC') place = (x < 3 || x > 6) && y >= ROWS - 4;
                else if (theme.name === 'STAIRS') place = x <= (ROWS - 1 - y);
                else if (theme.name === 'CANYON') place = (x < 2 || x > 7);
                else if (theme.name === 'ZIGZAG') place = (y % 2 === 0) ? (x < 8) : (x > 1);
                else if (theme.name === 'CHAOS') place = Math.random() > 0.5 && y >= ROWS - 5;
                if (place) grid[y][x] = `PUZZLE_${theme.color}`;
            }
        }
    }

    function hold() {
        if (!canHold || isPaused || isGameOver) return;
        const old = holdPiece; holdPiece = currentPiece.type;
        if (old) currentPiece = { type: old, matrix: SHAPES[old], rotation: 0, x: Math.floor(COLS / 2) - 2, y: 0 };
        else spawnPiece();
        canHold = false;
    }

    // --- 5. 描画とループ ---

    function drawBlock(c, x, y, color, size = BLOCK_SIZE, isGhost = false) {
        c.fillStyle = color; c.fillRect(x * size, y * size, size, size);
        c.strokeStyle = isGhost ? color : 'rgba(0,0,0,0.3)';
        c.lineWidth = isGhost ? 2 : 1;
        c.strokeRect(x * size, y * size, size, size);
    }

    function drawSide(c, type) {
        const cw = c.canvas.width, ch = c.canvas.height;
        c.clearRect(0, 0, cw, ch);
        if (!type) return;
        const m = SHAPES[type], bs = cw / 4;
        const sx = (cw - (m.length * bs)) / 2, sy = (ch - (m.length * bs)) / 2;
        m.forEach((row, y) => row.forEach((v, x) => {
            if (v) drawBlock(c, sx / bs + x, sy / bs + y, COLORS[type], bs);
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

        grid.forEach((row, y) => row.forEach((v, x) => {
            if (v) {
                const color = (typeof v === 'string' && v.startsWith('PUZZLE_')) ? v.replace('PUZZLE_', '') : COLORS[v];
                drawBlock(ctx, x, y, color);
            }
        }));

        if (currentPiece && !isGameOver) {
            const ghost = { ...currentPiece };
            while (isValid(ghost, 0, 1)) ghost.y++;
            ctx.globalAlpha = 0.3;
            ghost.matrix.forEach((row, y) => row.forEach((v, x) => {
                if (v) drawBlock(ctx, ghost.x + x, ghost.y + y, COLORS[currentPiece.type], BLOCK_SIZE, true);
            }));
            ctx.globalAlpha = 1.0;

            currentPiece.matrix.forEach((row, y) => row.forEach((v, x) => {
                if (v) drawBlock(ctx, currentPiece.x + x, currentPiece.y + y, COLORS[currentPiece.type]);
            }));
        }

        displays.score.textContent = score; displays.lines.textContent = lines;
        displays.level.textContent = gameMode === 'BIG_BANG' ? `WAVE ${bigBangStage}` : level;
        if (gameMode === '3_MIN') {
            const displayTime = Math.max(0, 180 - Math.floor(timer / 1000));
            displays.time.textContent = `${String(Math.floor(displayTime / 60)).padStart(2, '0')}:${String(displayTime % 60).padStart(2, '0')}`;
        } else if (gameMode !== 'NORMAL') {
            displays.time.textContent = (timer / 1000).toFixed(2);
        }

        drawSide(holdCtx, holdPiece);
        nextCtxs.forEach((c, i) => drawSide(c, nextPieces[i]));
    }

    function update(time = 0) {
        if (isGameOver) return showResult();
        if (!isPaused) {
            const dt = time - lastTime; lastTime = time;
            if (!isValid(currentPiece, 0, 1)) {
                lockDelayTimer += dt;
                if (lockDelayTimer >= 500) lockPiece();
            } else {
                dropCounter += dt;
                if (dropCounter > dropInterval) { softDrop(); dropCounter = 0; }
            }
            draw();
        }
        animationId = requestAnimationFrame(update);
    }

    // --- 6. 画面遷移と操作設定 ---

    function togglePause() {
        if (isGameOver) return;
        isPaused = !isPaused;
        overlays.pause.style.display = isPaused ? 'flex' : 'none';
        isPaused ? screens.game.classList.add('paused-blur') : screens.game.classList.remove('paused-blur');
        if (!isPaused) lastTime = performance.now();
    }

    function showResult() {
        clearInterval(timerInterval);
        overlays.result.style.display = 'flex';
        document.getElementById('result-title').textContent = (gameMode === '3_MIN' && isTimeUp) ? 'TIME UP!' : 'GAME OVER';
        document.getElementById('result-score').textContent = score;
        document.getElementById('result-lines').textContent = lines;
        if (gameMode !== 'NORMAL') {
            document.getElementById('result-time-row').style.display = 'block';
            document.getElementById('result-time').textContent = (timer / 1000).toFixed(2);
        }
    }

    function startGame(mode) {
        grid = createEmptyGrid();
        score = 0; lines = 0; level = 1; timer = 0; bigBangStage = 1;
        nextPieces = []; holdPiece = null;
        isGameOver = false; isPaused = false; isTimeUp = false; gameMode = mode;
        dropInterval = mode === '20G' ? 0 : 1000; dropCounter = 0;

        document.getElementById('time-container').style.display = mode === 'NORMAL' ? 'none' : 'block';
        if (mode === 'BIG_BANG') generateBigBangPuzzle();
        spawnPiece();

        clearInterval(timerInterval);
        if (mode !== 'NORMAL') timerInterval = setInterval(() => {
            if (!isPaused) {
                timer += 10;
                if (mode === '3_MIN' && timer >= 180000) { isTimeUp = true; isGameOver = true; }
            }
        }, 10);

        screens.menu.classList.remove('active'); screens.game.classList.add('active');
        overlays.result.style.display = 'none'; overlays.pause.style.display = 'none';
        screens.game.classList.remove('paused-blur');
        lastTime = performance.now();
        update();
    }

    function init() {
        document.getElementById('start-normal').onclick = () => startGame('NORMAL');
        document.getElementById('start-40lines').onclick = () => startGame('40_LINES');
        document.getElementById('start-bigbang').onclick = () => startGame('BIG_BANG');
        document.getElementById('start-3min').onclick = () => startGame('3_MIN');
        document.getElementById('start-20g').onclick = () => startGame('20G');

        document.getElementById('retry-button').onclick = () => startGame(gameMode);
        document.getElementById('menu-button').onclick = () => location.reload();
        document.getElementById('resume-btn').onclick = togglePause;
        document.getElementById('reset-btn').onclick = () => { togglePause(); startGame(gameMode); };
        document.getElementById('menu-back-btn').onclick = () => location.reload();

        const bindBtn = (id, fn) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
                el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
            }
        };

        const bindModBtn = (id, mult) => {
            const el = document.getElementById(id);
            if (el) {
                const on = (e) => { e.preventDefault(); moveMultiplier = mult; el.classList.add('active-mod'); };
                const off = (e) => { e.preventDefault(); moveMultiplier = 1; el.classList.remove('active-mod'); };
                el.addEventListener('touchstart', on, { passive: false });
                el.addEventListener('touchend', off);
                el.addEventListener('mousedown', on);
                el.addEventListener('mouseup', off);
                el.addEventListener('mouseleave', off);
            }
        };

        bindModBtn('mod-x2-btn', 2);
        bindModBtn('mod-x3-btn', 3);

        bindBtn('pause-btn-touch', togglePause);
        bindBtn('hold-btn-touch', hold);
        bindBtn('rotate-left-btn', () => rotate(-1)); 
        bindBtn('rotate-right-btn', () => rotate(1));
        bindBtn('rotate-180-btn', () => rotate(2));
        bindBtn('move-center-btn', moveToCenter); 
        bindBtn('move-edge-left-btn', () => moveToEdge(-1)); // 左端ボタン
        bindBtn('move-edge-right-btn', () => moveToEdge(1)); // 右端ボタン
        bindBtn('soft-drop-btn', () => softDrop()); 

        // 【追加】盤面上でのスワイプ操作（タブレット向け）
        let touchStartX = null, touchStartY = null;
        let lastTouchX = null, lastTouchY = null;
        
        boardCanvas.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            lastTouchX = touchStartX;
            lastTouchY = touchStartY;
        }, { passive: false });

        boardCanvas.addEventListener('touchmove', (e) => {
            e.preventDefault(); // 画面のスクロールを防止
            if (!touchStartX || !touchStartY || isPaused || isGameOver) return;
            
            const currentX = e.touches[0].clientX;
            const dx = currentX - lastTouchX;
            
            // 指をスライドさせた距離(25px)ごとにブロックを左右に移動
            if (Math.abs(dx) > 25) {
                move(dx > 0 ? 1 : -1);
                lastTouchX = currentX; 
            }
        }, { passive: false });

        boardCanvas.addEventListener('touchend', (e) => {
            if (!touchStartX || !touchStartY || isPaused || isGameOver) return;
            
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            
            const totalDy = touchEndY - touchStartY;
            const totalDx = touchEndX - touchStartX;
            
            // 下方向に素早く長くフリックした場合はハードドロップ
            if (totalDy > 40 && Math.abs(totalDy) > Math.abs(totalDx) * 1.5) {
                hardDrop();
            }
            
            touchStartX = null;
            touchStartY = null;
        });

        // キーボード操作
        document.onkeydown = (e) => {
            if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
            if (isPaused || isGameOver) return;

        // 「Shift」または「2」キーを押している間はx2
            if (e.key === 'Shift' || e.key === '2') moveMultiplier = 2;
            // 「Control」または「3」キーを押している間はx3
            if (e.key === 'Control' || e.metaKey || e.key === '3') moveMultiplier = 3;
            
            switch (e.code) {
                case 'ArrowLeft': move(-1); break;
                case 'ArrowRight': move(1); break;
                case 'ArrowDown': softDrop(); break;
                case 'ArrowUp': rotate(1); break;
                case 'KeyZ': rotate(-1); break;
                case 'KeyA': rotate(2); break;
                case 'KeyM': moveToCenter(); break;
                case 'Space': e.preventDefault(); hardDrop(); break;
                case 'KeyC': hold(); break;
                case 'KeyQ': moveToEdge(-1); break; // Qキーで左寄せ
                case 'KeyE': moveToEdge(1); break;  // Eキーで右寄せ
            }
        };

        document.onkeyup = (e) => {
            // 2や3のキーを離した時も、倍率を1に戻す
            if (e.key === 'Shift' || e.key === 'Control' || e.metaKey || e.key === '2' || e.key === '3') {
                moveMultiplier = 1;
            }
        };

        window.addEventListener('contextmenu', e => e.preventDefault());
    }

    init();
});