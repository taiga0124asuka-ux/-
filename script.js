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
    let BLOCK_SIZE = 30; // 画面サイズに応じて後で調整

    const COLORS = {
        'I': '#00f0f0', 'J': '#0000f0', 'L': '#f0a000', 'O': '#f0f000',
        'S': '#00f000', 'T': '#a000f0', 'Z': '#f00000'
    };

    // BIGBANG用の5つのテーマ設定
    const BIG_BANG_THEMES = [
        { name: 'CLASSIC', color: '#555555' }, { name: 'STAIRS', color: '#009688' },
        { name: 'CANYON', color: '#e53935' }, { name: 'ZIGZAG', color: '#9c27b0' }, { name: 'CHAOS', color: '#ffb300' }
    ];

    const SHAPES = {
        'I': [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], 'J': [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
        'L': [[0, 0, 1], [1, 1, 1], [0, 0, 0]], 'O': [[1, 1], [1, 1]], 'S': [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
        'T': [[0, 1, 0], [1, 1, 1], [0, 0, 0]], 'Z': [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
    };

    // --- 3. 状態管理変数 ---
    let grid, currentPiece, nextPieces, holdPiece, canHold;
    let score, lines, level, dropCounter, dropInterval, isGameOver, isPaused, gameMode;
    let timer, timerInterval, bigBangStage, lastTime, animationId;
    let isTimeUp = false;
    let lockDelayTimer = 0, lockResets = 0;

    // 【重要】同時押し（移動距離指定）と先行入力ガード用の変数
    let moveMultiplier = 1; // 1=通常, 2=x2, 3=x3
    let lastActionTime = 0; // 連打バグ防止用の最終アクション記録時間

    // レスポンシブ対応（キャンバスサイズの自動調整）
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
            type, matrix: SHAPES[type], rotation: 0,
            x: Math.floor(COLS / 2) - Math.floor(SHAPES[type][0].length / 2),
            y: type === 'I' ? -1 : 0
        };
        canHold = true; lockDelayTimer = 0; lockResets = 0;

        // 20Gモードなら生成直後に一番下まで落とす
        if (gameMode === '20G') while (isValid(currentPiece, 0, 1)) currentPiece.y++;

        // 窒息判定
        if (!isValid(currentPiece)) {
            // その場で動かせるか回転できるなら猶予を与える
            const canSurvive = isValid(currentPiece, -1, 0) || isValid(currentPiece, 1, 0) || isValid({ ...currentPiece, matrix: getRotatedMatrix(currentPiece.matrix, 1) });
            if (!canSurvive || gameMode !== '20G') isGameOver = true;
        }
    }

    // 壁やブロックとの衝突判定
    function isValid(piece, ox = 0, oy = 0, matrix = piece.matrix) {
        return matrix.every((row, y) => row.every((val, x) => {
            if (!val) return true;
            let nx = piece.x + x + ox, ny = piece.y + y + oy;
            return (nx >= 0 && nx < COLS && ny < ROWS && (ny < 0 || grid[ny][nx] === 0));
        }));
    }

    // 行列の回転ロジック
    function getRotatedMatrix(m, dir) {
        const n = m.length;
        if (dir === 1) return m.map((row, i) => row.map((_, j) => m[n - 1 - j][i])); // 右90度
        if (dir === -1) return m.map((row, i) => row.map((_, j) => m[j][n - 1 - i])); // 左90度
        if (dir === 2) return m.map(row => [...row].reverse()).reverse(); // 【追加】180度回転
        return m;
    }

    // 回転処理
    function rotate(dir) {
        if (isPaused || isGameOver || currentPiece.type === 'O') return;
        const now = Date.now();
        if (now - lastActionTime < 50) return; // わずかなクールダウンで連打バグ防止
        lastActionTime = now;

        const nextMatrix = getRotatedMatrix(currentPiece.matrix, dir);

        // 180度の場合は簡易的なキック（そのまま、右1、左1、上1）、90度は本来SRSが必要ですが簡略化して衝突回避
        const kicks = [[0, 0], [1, 0], [-1, 0], [0, -1], [2, 0], [-2, 0]];
        for (const [kx, ky] of kicks) {
            if (isValid(currentPiece, kx, -ky, nextMatrix)) {
                currentPiece.x += kx; currentPiece.y -= ky;
                currentPiece.matrix = nextMatrix;
                resetLockDelay(); return;
            }
        }
    }

    // 【重要】移動処理（同時押しによる multiplier を適用し、壁を突き抜けないように1マスずつ判定）
    function move(dx) {
        if (isPaused || isGameOver) return;
        const now = Date.now();
        if (now - lastActionTime < 80) return; // 先行入力ガード
        lastActionTime = now;

        let moved = 0;
        // 指定された距離（moveMultiplier）分、壁にぶつかるまで1マスずつ進める
        while (moved < moveMultiplier && isValid(currentPiece, dx, 0)) {
            currentPiece.x += dx;
            moved++;
        }
        if (moved > 0) resetLockDelay();
    }
    // 【新規追加】横軸の中央へ一気に移動する処理
    function moveToCenter() {
        if (isPaused || isGameOver) return;
        const now = Date.now();
        if (now - lastActionTime < 80) return; // 先行入力ガード
        lastActionTime = now;

        // ブロックの中心が盤面の中央（COLS/2）になるようなX座標を計算
        const targetX = Math.floor(COLS / 2) - Math.floor(currentPiece.matrix[0].length / 2);
        if (currentPiece.x === targetX) return; // すでに中央なら何もしない

        const step = targetX > currentPiece.x ? 1 : -1; // 右に動くべきか左に動くべきか
        let moved = false;

        // 障害物にぶつかるか、中央に到達するまで1マスずつ進める（壁抜け防止）
        while (currentPiece.x !== targetX && isValid(currentPiece, step, 0)) {
            currentPiece.x += step;
            moved = true;
        }
        
        if (moved) resetLockDelay();
    }

    // 【重要】ソフトドロップ（移動同様に multiplier を適用）
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

    // 【重要】BIG BANGのブロック消去とクリア判定
    function clearLines() {
        let cleared = 0;
        // 1. ラインが完全に埋まっているか判定して消去
        for (let y = ROWS - 1; y >= 0; y--) {
            // 空マス（0）が含まれていなければ、ライン成立とみなす
            // （BIG BANGのお邪魔ブロック 'PUZZLE_...' もブロックとして扱う）
            if (grid[y].every(cell => cell !== 0)) {
                grid.splice(y, 1);
                grid.unshift(Array(COLS).fill(0));
                cleared++;
                y++; // ズレたので同じ行を再判定
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

        // 2. BIG BANGモード特有の「お邪魔全消し判定」
        if (gameMode === 'BIG_BANG') {
            // 盤面に 'PUZZLE_' で始まる文字列が一つも残っていないかチェック
            const hasPuzzle = grid.some(row => row.some(cell => typeof cell === 'string' && cell.startsWith('PUZZLE_')));

            if (!hasPuzzle) {
                // お邪魔ブロックが全滅したら、プレイヤーのブロックも全て消去する
                grid = createEmptyGrid();
                bigBangStage++;
                if (bigBangStage > 5) {
                    isGameOver = true; // 5ステージクリアで終了
                } else {
                    generateBigBangPuzzle(); // 次のウェーブへ
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
                // PUZZLE_ というプレフィックスをつけて記録
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

        // 背景ブロック描画
        grid.forEach((row, y) => row.forEach((v, x) => {
            if (v) {
                // PUZZLE_ の場合はそれに続くカラーコードを抽出し、それ以外は通常カラーを使用
                const color = (typeof v === 'string' && v.startsWith('PUZZLE_')) ? v.replace('PUZZLE_', '') : COLORS[v];
                drawBlock(ctx, x, y, color);
            }
        }));

        if (currentPiece && !isGameOver) {
            // ゴースト（30%半透明＋フチ）
            const ghost = { ...currentPiece };
            while (isValid(ghost, 0, 1)) ghost.y++;
            ctx.globalAlpha = 0.3;
            ghost.matrix.forEach((row, y) => row.forEach((v, x) => {
                if (v) drawBlock(ctx, ghost.x + x, ghost.y + y, COLORS[currentPiece.type], BLOCK_SIZE, true);
            }));
            ctx.globalAlpha = 1.0;

            // 操作ミノ
            currentPiece.matrix.forEach((row, y) => row.forEach((v, x) => {
                if (v) drawBlock(ctx, currentPiece.x + x, currentPiece.y + y, COLORS[currentPiece.type]);
            }));
        }

        // UI更新
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
        // メニューボタン
        document.getElementById('start-normal').onclick = () => startGame('NORMAL');
        document.getElementById('start-40lines').onclick = () => startGame('40_LINES');
        document.getElementById('start-bigbang').onclick = () => startGame('BIG_BANG');
        document.getElementById('start-3min').onclick = () => startGame('3_MIN');
        document.getElementById('start-20g').onclick = () => startGame('20G');

        // リザルト＆ポーズのUIボタン
        document.getElementById('retry-button').onclick = () => startGame(gameMode);
        document.getElementById('menu-button').onclick = () => location.reload();
        document.getElementById('resume-btn').onclick = togglePause;
        document.getElementById('reset-btn').onclick = () => { togglePause(); startGame(gameMode); };
        document.getElementById('menu-back-btn').onclick = () => location.reload();

        // スマホ用タッチ操作（prevent defaultで遅延防止）
        const bindBtn = (id, fn) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
                el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
            }
        };

        // 【重要】同時押し修飾ボタン (押している間だけ multiplier が変わる)
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
        bindBtn('hard-drop-btn', hardDrop);
        bindBtn('rotate-left-btn', () => rotate(-1)); // ★この1行を追加！
        bindBtn('rotate-right-btn', () => rotate(1));
        bindBtn('rotate-180-btn', () => rotate(2));
        bindBtn('move-center-btn', moveToCenter); // ★この1行を追加！
        bindBtn('move-left-btn', () => move(-1));
        bindBtn('move-right-btn', () => move(1));
        bindBtn('soft-drop-btn', () => softDrop()); // 単純なソフトドロップボタン

        // キーボード操作
        // --- 285行目付近からのイベントリスナー ---
        // キーボード操作
        document.onkeydown = (e) => {
            if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
            if (isPaused || isGameOver) return;

            // ★ここが現在、修飾キー（ShiftやCtrl）で倍率を決めている部分です
            // キーボードの場合、Shiftキーでx2、Ctrlキーでx3として扱う
            if (e.key === 'Shift') moveMultiplier = 2;
            if (e.key === 'Control' || e.metaKey) moveMultiplier = 3;
             switch (e.code) {
                case 'ArrowLeft': move(-1); break;
                case 'ArrowRight': move(1); break;
                case 'ArrowLeft': move(-1); break;
                case 'ArrowRight': move(1); break;
                case 'ArrowDown': softDrop(); break;
                case 'ArrowUp': rotate(1); break;
                case 'KeyZ': rotate(-1); break;
                case 'KeyA': rotate(2); break;
                case 'KeyM': moveToCenter(); break; // ★この1行を追加（Mキーで中央へ）
                case 'Space': e.preventDefault(); hardDrop(); break;
                case 'KeyC': hold(); break;
            }
        };

        document.onkeyup = (e) => {
            // キーを離した時に倍率を元に戻す
            if (e.key === 'Shift' || e.key === 'Control' || e.metaKey) moveMultiplier = 1;
        };

        window.addEventListener('contextmenu', e => e.preventDefault());
    }

    init();
});