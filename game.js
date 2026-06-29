document.addEventListener('DOMContentLoaded', () => {
    const SERVER_URL = (window.location.protocol === 'file:' || window.location.protocol === 'capacitor:')
        ? 'https://b4ris.alwaysdata.net'
        : window.location.origin;
    const socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 60000
    });
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // Drawing constants (physics now runs entirely on the server)
    let PADDLE_RADIUS = 30;
    let PUCK_RADIUS = 15;
    const GOAL_WIDTH_RATIO = 0.66; // Kale genişliği ekranın 2/3'ü

    // Load paddle images
    const paddle1Image = new Image();
    const paddle2Image = new Image();
    const puckImage = new Image();
    paddle1Image.src = 'assets/images/paddle-green.png';
    paddle2Image.src = 'assets/images/paddle-red.png';
    puckImage.src = 'assets/images/disk.png';

    // Game state
    let gameStarted = false;
    let roomId = null;
    let playerNumber = null;
    let playerName = "";
    let opponentName = "Bekleniyor...";
    let scoreLimit = 5; // Varsayılan skor limiti
    let courtType = 'half'; // Varsayılan saha tipi
    let pendingBotMode = false; // true while the settings popup was opened for single-player (bot)
    // Render state (canvas coords). The puck and the opponent paddle come from the
    // server; our own paddle is predicted locally for instant feedback.
    let paddle1 = { x: 0, y: 0 };
    let paddle2 = { x: 0, y: 0 };
    let puck = { x: 0, y: 0 };
    // Interpolation targets — server snapshots land here; renderLoop lerps toward them
    let puckTarget = { x: 0, y: 0 };
    let oppTarget = { x: 0, y: 0 };
    let score = { player1: 0, player2: 0 };
    // Hit flash timestamp (ms) — used for visual impact glow on own paddle
    let hitFlashTime = 0;
    let hitFlashPlayer = 0; // which paddle to flash on contact (1 or 2)
    // Puck speed from server (normalized 0-1); used for speed-glow visualization
    let puckSpeed = 0;
    // Cancel functions for reconnect countdowns (opponent + self)
    let reconnectCountdownTimer = null; // opponent disconnect cancel fn

    // Socket connection status
    let isConnected = false;

    // Reconnect / pause state (#3)
    let gamePaused = false;        // true while opponent is temporarily disconnected
    let hasJoinedGame = false;     // true once we are in a room (enables auto-rejoin)
    let renderRunning = false;     // render loop guard

    // Ses efektleri için Audio objeleri ve yönetimi
    let goalSound = null;
    let hitSound = null;
    let soundsLoaded = false;
    let soundsInitialized = false;

    // Rastgele renk seçimi için renkler
    const goalColors = [
        '#39ff14', // Neon Yeşil
        '#ff1493', // Neon Pembe
        '#00ffff', // Cyan
        '#ff4500', // Turuncu Kırmızı
        '#ff0', // Sarı
        '#f0f', // Magenta
        '#1e90ff', // Dodger Mavi
        '#ff3800', // Neon Kırmızı
        '#9400d3', // Mor
        '#7fff00'  // Chartreuse
    ];

    // Rastgele renk seç
    function getRandomGoalColor() {
        return goalColors[Math.floor(Math.random() * goalColors.length)];
    }

    // Sesleri yükle ve hazırla
    function initSounds(event) {
        // Eğer event bir buton, input veya menü elementinden geliyorsa, ses başlatmayı engelle
        if (event && event.target && (
            event.target.tagName === 'INPUT' || 
            event.target.tagName === 'TEXTAREA' || 
            event.target.tagName === 'BUTTON' ||
            event.target.id === 'menu' ||
            event.target.id === 'mainMenu' ||
            event.target.id === 'waitingRoom' ||
            event.target.id === 'scoreLimitPopup' ||
            event.target.classList.contains('menu-button') ||
            event.target.closest('.menu-button') ||
            event.target.closest('#menu') ||
            event.target.closest('#mainMenu') ||
            event.target.closest('#waitingRoom') ||
            event.target.closest('#scoreLimitPopup')
        )) {
            console.log('Ignoring sound initialization from menu/button interaction');
            return;
        }

        if (!soundsInitialized) {
            soundsInitialized = true;
            
            goalSound = new Audio('assets/sounds/gol.mp3');
            hitSound = new Audio('assets/sounds/hit.mp3');
            
            // Ses seviyelerini ayarla
            goalSound.volume = 0.7;
            hitSound.volume = 0.5;

            // iOS/Safari için sesleri önceden yükle
            goalSound.load();
            hitSound.load();

            // iOS/Safari için sessiz bir test çalma yap
            Promise.all([
                goalSound.play().then(() => {
                    goalSound.pause();
                    goalSound.currentTime = 0;
                }).catch(e => console.log('Initial goal sound load error:', e)),
                hitSound.play().then(() => {
                    hitSound.pause();
                    hitSound.currentTime = 0;
                }).catch(e => console.log('Initial hit sound load error:', e))
            ]).then(() => {
                console.log('Sounds initialized successfully');
                soundsLoaded = true;
            }).catch(error => {
                console.log('Sound initialization error:', error);
                soundsInitialized = false; // Hata durumunda tekrar denenmesine izin ver
            });
        }
    }

    // Ses çalma fonksiyonu
    async function playSound(sound) {
        if (!sound || !soundsLoaded) return;
        
        try {
            // Sesi baştan başlat
            sound.currentTime = 0;
            await sound.play();
        } catch (error) {
            console.log('Sound play error:', error);
            // Ses çalma hatası durumunda soundsInitialized'ı sıfırla
            soundsInitialized = false;
        }
    }

    // Oyun başladığında ve kullanıcı etkileşiminde sesleri yükle
    // Sadece canvas üzerindeki etkileşimlerde sesleri başlat
    canvas.addEventListener('touchstart', initSounds, { passive: true });
    canvas.addEventListener('click', initSounds, { passive: true });

    // Çarpışma sesini çal ve diğer oyuncuya bildir
    async function playHitSound() {
        if (hitSound && soundsLoaded) {
            await playSound(hitSound);
        }
    }

    // Gol sesini çal ve diğer oyuncuya bildir
    async function playGoalSound() {
        if (goalSound && soundsLoaded) {
            await playSound(goalSound);
        }
    }

    // Full-screen overlay for reconnect / pause messages.
    // `message` may contain \n for line breaks.
    function showOverlay(message, secondLine) {
        let overlay = document.getElementById('reconnectOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'reconnectOverlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'background:rgba(0,0,0,0.82);color:#fff;display:flex;flex-direction:column;' +
                'align-items:center;justify-content:center;text-align:center;z-index:1500;' +
                "font-family:'Montserrat','Arial',sans-serif;padding:24px;gap:14px;";
            document.body.appendChild(overlay);
        }
        // Main message
        const lines = message.split('\n');
        let html = `<div style="font-size:20px;opacity:0.9;line-height:1.5;">${lines.join('<br>')}</div>`;
        // Optional second line: big countdown number
        if (secondLine !== undefined) {
            html += `<div style="font-size:52px;font-weight:bold;color:#ff9900;` +
                    `text-shadow:0 0 20px #ff9900;">${secondLine}</div>`;
        }
        overlay.innerHTML = html;
        overlay.style.display = 'flex';
    }

    function hideOverlay() {
        const overlay = document.getElementById('reconnectOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    // Quick-match "searching for opponent" overlay with a cancel button.
    function showSearching() {
        let overlay = document.getElementById('searchingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'searchingOverlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'background:rgba(0,0,0,0.88);color:#fff;display:flex;flex-direction:column;' +
                'align-items:center;justify-content:center;text-align:center;z-index:1600;' +
                "font-family:'Montserrat','Arial',sans-serif;padding:24px;gap:22px;";
            overlay.innerHTML =
                '<div style="font-size:22px;opacity:0.95;">Rakip aranıyor...</div>' +
                '<div class="qm-spinner" style="width:46px;height:46px;border:4px solid rgba(255,255,255,0.25);' +
                'border-top-color:#ffd200;border-radius:50%;animation:qmspin 0.9s linear infinite;"></div>' +
                '<button id="cancelSearchBtn" style="padding:14px 28px;font-size:17px;border:none;border-radius:12px;' +
                'background:linear-gradient(90deg,#FF416C 0%,#FF4B2B 100%);color:#fff;font-weight:bold;cursor:pointer;">İptal</button>';
            document.body.appendChild(overlay);
            // Keyframes for the spinner (added once)
            if (!document.getElementById('qmSpinStyle')) {
                const st = document.createElement('style');
                st.id = 'qmSpinStyle';
                st.textContent = '@keyframes qmspin{to{transform:rotate(360deg)}}';
                document.head.appendChild(st);
            }
            overlay.querySelector('#cancelSearchBtn').addEventListener('click', cancelQuickMatch);
        }
        overlay.style.display = 'flex';
    }

    function hideSearching() {
        const overlay = document.getElementById('searchingOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    let searching = false;
    function startQuickMatch() {
        if (searching) return;
        searching = true;
        if (!socket.connected) socket.connect();
        showSearching();
        socket.emit('quickMatch', { playerName });
    }

    function cancelQuickMatch() {
        searching = false;
        socket.emit('cancelMatch');
        hideSearching();
    }

    // Countdown helper — shows a ticking overlay; returns a cancel function
    const GRACE_SEC = 20; // must match server REJOIN_GRACE_MS / 1000
    function startOverlayCountdown(titleLine, onExpire) {
        let remaining = GRACE_SEC;
        showOverlay(titleLine, remaining);
        const timer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(timer);
                if (onExpire) onExpire();
            } else {
                showOverlay(titleLine, remaining);
            }
        }, 1000);
        return () => clearInterval(timer); // cancel fn
    }

    // Set canvas size based on window size
    function resizeCanvas() {
        const aspectRatio = 9/16; // Dikey format için ideal oran
        const maxHeight = window.innerHeight;
        const maxWidth = window.innerWidth;
        
        if (maxHeight / maxWidth > aspectRatio) {
            canvas.width = maxWidth;
            canvas.height = maxWidth / aspectRatio;
        } else {
            canvas.height = maxHeight;
            canvas.width = maxHeight * aspectRatio;
        }
        
        // Yeni boyutlara göre oyun alanını güncelle
        PADDLE_RADIUS = canvas.width * 0.1; // Ekran genişliğine göre raket boyutu
        PUCK_RADIUS = PADDLE_RADIUS * 0.5; // Raket boyutuna göre pak boyutu
    }

    // İlk boyutlandırma
    resizeCanvas();

    // Pencere boyutu değiştiğinde yeniden boyutlandır
    window.addEventListener('resize', resizeCanvas);

    // Initialize render state to sensible defaults before the first server snapshot
    function initGame() {
        const centerX = canvas.width / 2;
        paddle1 = { x: centerX, y: canvas.height - PADDLE_RADIUS * 2 };
        paddle2 = { x: centerX, y: PADDLE_RADIUS * 2 };
        puck = { x: centerX, y: canvas.height / 2 };
        puckTarget = { x: centerX, y: canvas.height / 2 };
        oppTarget = {
            x: centerX,
            y: playerNumber === 1 ? PADDLE_RADIUS * 2 : canvas.height - PADDLE_RADIUS * 2
        };
        score = { player1: 0, player2: 0 };
        draw();
    }

    // Draw game elements
    function draw() {
        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Save the current context state
        ctx.save();

        // Player 2 için oyun alanını 180 derece döndür
        if (playerNumber === 2) {
            ctx.translate(canvas.width, canvas.height);
            ctx.rotate(Math.PI);
        }

        // Draw center line (yatay çizgi)
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([5, 15]);
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw goals (üst ve alt kenarlarda)
        const goalWidth = canvas.width * GOAL_WIDTH_RATIO;
        const goalStart = (canvas.width - goalWidth) / 2;
        const goalThickness = 5;

        // Top goal (Player 2)
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, canvas.width, goalThickness);
        ctx.fillRect(0, 0, goalStart, 20);
        ctx.fillRect(goalStart + goalWidth, 0, goalStart, 20);
        
        // Goal line indicators
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = goalThickness;
        ctx.beginPath();
        ctx.moveTo(goalStart, 0);
        ctx.lineTo(goalStart, 20);
        ctx.moveTo(goalStart + goalWidth, 0);
        ctx.lineTo(goalStart + goalWidth, 20);
        ctx.stroke();

        // Bottom goal (Player 1)
        ctx.fillStyle = '#333';
        ctx.fillRect(0, canvas.height - goalThickness, canvas.width, goalThickness);
        ctx.fillRect(0, canvas.height - 20, goalStart, 20);
        ctx.fillRect(goalStart + goalWidth, canvas.height - 20, goalStart, 20);
        
        // Goal line indicators
        ctx.beginPath();
        ctx.moveTo(goalStart, canvas.height);
        ctx.lineTo(goalStart, canvas.height - 20);
        ctx.moveTo(goalStart + goalWidth, canvas.height);
        ctx.lineTo(goalStart + goalWidth, canvas.height - 20);
        ctx.stroke();

        // Draw goal areas with semi-transparent overlay
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(goalStart, 0, goalWidth, 20);
        ctx.fillRect(goalStart, canvas.height - 20, goalWidth, 20);

        // Draw player names (raketlerin üstünde)
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        
        // Player names and scores based on current player's perspective
        const isPlayer2View = playerNumber === 2;
        
        // Player 2 (Üst) ismi - Kırmızı oyuncu
        const player2Text = playerNumber === 2 ? playerName : opponentName;
        if (isPlayer2View) {
            // Player 2 için kendi ismini çiz (altta)
            ctx.save();
            ctx.translate(paddle2.x, paddle2.y - PADDLE_RADIUS - 10);
            ctx.rotate(Math.PI); // 180 derece döndür
            ctx.fillText(player2Text, 0, 0);
            ctx.restore();
        } else {
            // Player 1 için rakibin ismini çiz (üstte)
            ctx.save();
            ctx.translate(paddle2.x, paddle2.y + PADDLE_RADIUS + 25);
            ctx.fillText(player2Text, 0, 0);
            ctx.restore();
        }
        
        // Player 1 (Alt) ismi - Yeşil oyuncu
        const player1Text = playerNumber === 1 ? playerName : opponentName;
        if (isPlayer2View) {
            // Player 2 için rakibin ismini çiz (üstte)
            ctx.save();
            ctx.translate(paddle1.x, paddle1.y + PADDLE_RADIUS + 25);
            ctx.rotate(Math.PI); // 180 derece döndür
            ctx.fillText(player1Text, 0, 0);
            ctx.restore();
        } else {
            // Player 1 için kendi ismini çiz (altta)
            ctx.save();
            ctx.translate(paddle1.x, paddle1.y - PADDLE_RADIUS - 10);
            ctx.fillText(player1Text, 0, 0);
            ctx.restore();
        }

        // Draw scores (yarı sahalarda ortalı ve büyük)
        ctx.font = 'bold 60px Arial';
        ctx.textAlign = 'center';
        
        // Skorlar her zaman aynı: Alt = player1 (yeşil), Üst = player2 (kırmızı)
        if (!isPlayer2View) {
            // Üst skor (rakip - kırmızı)
            ctx.save();
            ctx.translate(canvas.width/2, canvas.height/4);
            ctx.rotate(Math.PI);
            ctx.fillStyle = 'rgba(244, 67, 54, 0.2)';
            ctx.fillText(score.player2.toString(), 0, 0);
            ctx.restore();
            
            // Alt skor (kendisi - yeşil)
            ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
            ctx.fillText(score.player1.toString(), canvas.width/2, canvas.height * 3/4);
        } else {
            // Üst skor (rakip - kırmızı)
            ctx.save();
            ctx.translate(canvas.width/2, canvas.height/4);
            ctx.rotate(Math.PI);
            ctx.fillStyle = 'rgba(244, 67, 54, 0.2)';
            ctx.fillText(score.player2.toString(), 0, 0);
            ctx.restore();
            
            // Alt skor (kendisi - yeşil)
            ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
            ctx.fillText(score.player1.toString(), canvas.width/2, canvas.height * 3/4);
        }

        // Hit flash: radial glow behind whichever paddle actually struck the puck
        const flashAge = Date.now() - hitFlashTime;
        if (hitFlashTime > 0 && flashAge < 250) {
            const alpha = (1 - flashAge / 250) * 0.9;
            const ownP = hitFlashPlayer === 1 ? paddle1 : paddle2;
            ctx.save();
            ctx.translate(ownP.x, ownP.y);
            const g = ctx.createRadialGradient(0, 0, PADDLE_RADIUS * 0.5, 0, 0, PADDLE_RADIUS * 2.4);
            g.addColorStop(0, `rgba(255, 240, 80, ${alpha})`);
            g.addColorStop(1, 'rgba(255, 180, 0, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, PADDLE_RADIUS * 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Draw paddles with images
        const paddleSize = PADDLE_RADIUS * 2;

        // Draw paddle 1 (bottom player - green)
        ctx.save();
        ctx.translate(paddle1.x, paddle1.y);
        if (isPlayer2View) ctx.rotate(Math.PI);
        ctx.drawImage(paddle1Image, -paddleSize/2, -paddleSize/2, paddleSize, paddleSize);
        ctx.restore();

        // Draw paddle 2 (top player - red)
        ctx.save();
        ctx.translate(paddle2.x, paddle2.y);
        if (isPlayer2View) ctx.rotate(Math.PI);
        ctx.drawImage(paddle2Image, -paddleSize/2, -paddleSize/2, paddleSize, paddleSize);
        ctx.restore();

        // Draw puck with image + speed glow (white→yellow→red as puck accelerates)
        const puckSize = PUCK_RADIUS * 2;
        if (puckSpeed > 0.25) {
            const t = Math.min((puckSpeed - 0.25) / 0.75, 1); // 0 at slow, 1 at max speed
            const g2 = Math.round(200 * (1 - t));             // 200→0  (yellow→red)
            const glowAlpha = 0.35 + t * 0.45;
            ctx.save();
            ctx.translate(puck.x, puck.y);
            const speedGlow = ctx.createRadialGradient(0, 0, PUCK_RADIUS * 0.3, 0, 0, PUCK_RADIUS * 3);
            speedGlow.addColorStop(0, `rgba(255, ${g2}, 0, ${glowAlpha})`);
            speedGlow.addColorStop(1, 'rgba(255, 0, 0, 0)');
            ctx.fillStyle = speedGlow;
            ctx.beginPath();
            ctx.arc(0, 0, PUCK_RADIUS * 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.save();
        ctx.translate(puck.x, puck.y);
        ctx.drawImage(puckImage, -puckSize/2, -puckSize/2, puckSize, puckSize);
        ctx.restore();

        // Restore the original context state
        ctx.restore();
    }

    // Convert relative position (0-1) to canvas coordinates
    function relativeToCanvas(relX, relY) {
        return {
            x: relX * canvas.width,
            y: relY * canvas.height
        };
    }

    // Convert canvas coordinates to relative position (0-1)
    function canvasToRelative(canvasX, canvasY) {
        return {
            x: canvasX / canvas.width,
            y: canvasY / canvas.height
        };
    }

    // Soft-reset back to the main menu without reloading the page (Capacitor-friendly:
    // location.reload() causes a white flash + full socket teardown on iOS WebView).
    // Keeps the entered player name; tears down the current game/socket-room cleanly.
    function resetToMenu() {
        // Stop gameplay & rendering
        gameStarted = false;
        renderRunning = false;
        gamePaused = false;
        hasJoinedGame = false;
        removeGameEventListeners();

        // Cancel any countdown overlays
        if (reconnectCountdownTimer) { reconnectCountdownTimer(); reconnectCountdownTimer = null; }
        if (selfDisconnectCancel) { selfDisconnectCancel(); selfDisconnectCancel = null; }
        hideOverlay();
        searching = false;
        hideSearching();

        // Reset game state (keep playerName so user doesn't re-enter it)
        playerNumber = null;
        roomId = null;
        score = { player1: 0, player2: 0 };
        opponentName = "Bekleniyor...";
        puckSpeed = 0;
        hitFlashTime = 0;

        // Remove the game-over dialog if present
        const go = document.getElementById('gameOverDialog');
        if (go) go.remove();

        // Hide gameplay UI
        const canvasEl = document.getElementById('gameCanvas');
        if (canvasEl) canvasEl.style.display = 'none';
        const goalAnim = document.getElementById('goalAnimation');
        if (goalAnim) { goalAnim.style.display = 'none'; goalAnim.classList.remove('show'); }
        const startCountdown = document.getElementById('startCountdown');
        if (startCountdown) startCountdown.style.display = 'none';

        // Show the menu (player already named) on the main-menu screen
        const menu = document.getElementById('menu');
        const mainMenu = document.getElementById('mainMenu');
        const waitingRoom = document.getElementById('waitingRoom');
        const scoreLimitPopup = document.getElementById('scoreLimitPopup');
        if (waitingRoom) waitingRoom.style.display = 'none';
        if (scoreLimitPopup) scoreLimitPopup.style.display = 'none';
        if (mainMenu) mainMenu.style.display = 'block';
        if (menu) menu.style.display = 'block';

        // Clear the room-code input
        const roomInput = document.getElementById('roomId');
        if (roomInput) roomInput.value = '';

        // Refresh the socket so stale room references on the server are dropped
        if (socket) {
            socket.disconnect();
            socket.connect();
        }

        window.scrollTo(0, 0);
    }

    // Show game over message
    function showGameOver(message) {
        const gameOverDiv = document.createElement('div');
        gameOverDiv.id = 'gameOverDialog';
        gameOverDiv.style.position = 'fixed';
        gameOverDiv.style.top = '0';
        gameOverDiv.style.left = '0';
        gameOverDiv.style.width = '100%';
        gameOverDiv.style.height = '100%';
        gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        gameOverDiv.style.display = 'flex';
        gameOverDiv.style.alignItems = 'center';
        gameOverDiv.style.justifyContent = 'center';
        gameOverDiv.style.zIndex = '2000';

        const contentDiv = document.createElement('div');
        contentDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
        contentDiv.style.padding = '32px 20px 28px 20px';
        contentDiv.style.borderRadius = '18px';
        contentDiv.style.textAlign = 'center';
        contentDiv.style.width = '90vw';
        contentDiv.style.maxWidth = '320px';
        contentDiv.style.boxShadow = '0 8px 32px rgba(0,0,0,0.25)';

        const title = document.createElement('h2');
        title.textContent = message;
        title.style.color = 'white';
        title.style.fontSize = '24px';
        title.style.margin = '0 0 20px 0';
        title.style.fontFamily = "'Montserrat', 'Arial', sans-serif";

        const button = document.createElement('button');
        button.textContent = 'Yeni Oyun';
        button.style.padding = '18px 0';
        button.style.width = '100%';
        button.style.fontSize = '22px';
        button.style.borderRadius = '12px';
        button.style.border = 'none';
        button.style.background = 'linear-gradient(90deg, #43e97b 0%, #38f9d7 100%)';
        button.style.color = 'white';
        button.style.cursor = 'pointer';
        button.style.fontWeight = 'bold';
        button.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
        button.style.transition = 'background 0.2s, box-shadow 0.2s';

        button.addEventListener('mousedown', () => {
            button.style.background = 'linear-gradient(90deg, #11998e 0%, #38ef7d 100%)';
            button.style.boxShadow = '0 1px 4px rgba(0,0,0,0.18)';
        });

        button.addEventListener('click', () => {
            resetToMenu();
        });

        contentDiv.appendChild(title);
        contentDiv.appendChild(button);
        gameOverDiv.appendChild(contentDiv);
        document.body.appendChild(gameOverDiv);

        // Oyunu 1 saniye sonra durdur
        setTimeout(() => {
            gameStarted = false;
            renderRunning = false;
            removeGameEventListeners();
        }, 1000);
    }

    // Show goal animation
    function showGoalAnimation() {
        console.log('Showing goal animation, Player:', playerNumber);
        const goalAnim = document.getElementById('goalAnimation');
        
        if (!goalAnim) {
            console.error('Goal animation element not found');
            return;
        }
        
        // Rastgele renk seç ve uygula
        const randomColor = getRandomGoalColor();
        goalAnim.style.color = randomColor;
        
        // Gol sesini çal
        playGoalSound();
        
        // Animasyonu sıfırla
        goalAnim.style.display = 'block';
        goalAnim.classList.remove('show');
        
        // Force reflow
        void goalAnim.offsetWidth;
        
        // Animasyonu başlat
        goalAnim.classList.add('show');
        
        // Titreşim efekti
        try {
            if ('vibrate' in navigator) {
                navigator.vibrate([100, 50, 100]);
            }
        } catch (error) {
            console.log('Vibration not supported');
        }
        
        // Animasyon bitince temizle
        setTimeout(() => {
            goalAnim.classList.remove('show');
            setTimeout(() => {
                goalAnim.style.display = 'none';
            }, 500);
        }, 1500);
    }

    // Oyun sonu işlemlerini yapacak fonksiyon
    function handleGameOver(winner) {
        console.log('Game Over - Winner:', winner);

        // Oyunu durdur
        gameStarted = false;
        hasJoinedGame = false; // Oyun bitti, reconnect deneme

        // Kazanan/kaybeden durumunu belirle ve mesajı göster
        const message = winner === playerNumber ? "Kazandınız!" : "Kaybettiniz!";
        showGameOver(message);

        // Event listener'ları kaldır
        removeGameEventListeners();
    }

    // Socket event handler for game over
    socket.on('gameOver', (data) => {
        console.log('Game over event received:', data);
        handleGameOver(data.winner);
    });

    // Render loop: interpolate toward server targets to smooth network jitter,
    // then draw. Own paddle stays locally predicted (no lerp needed).
    function renderLoop() {
        if (!renderRunning) return;
        // Lerp puck and opponent paddle toward the last server snapshot
        puck.x += (puckTarget.x - puck.x) * 0.45;
        puck.y += (puckTarget.y - puck.y) * 0.45;
        if (playerNumber === 1) {
            paddle2.x += (oppTarget.x - paddle2.x) * 0.3;
            paddle2.y += (oppTarget.y - paddle2.y) * 0.3;
        } else {
            paddle1.x += (oppTarget.x - paddle1.x) * 0.3;
            paddle1.y += (oppTarget.y - paddle1.y) * 0.3;
        }
        draw();
        requestAnimationFrame(renderLoop);
    }

    function startRenderLoop() {
        if (renderRunning) return;
        renderRunning = true;
        requestAnimationFrame(renderLoop);
    }

    // Geri sayım bitti: girdi dinleyicilerini aç ve server'a hazır olduğumuzu bildir
    function startGameplay() {
        console.log('Gameplay starting now!');
        gameStarted = true;

        const canvas = document.getElementById('gameCanvas');
        if (canvas) {
            canvas.style.display = 'block';
            resizeCanvas();
        }

        addGameEventListeners();
        startRenderLoop();

        // Server fiziği yalnızca iki oyuncu da hazır olunca başlatır
        socket.emit('playerReady', { roomId });
    }

    function startGame() {
        console.log('Starting game as Player', playerNumber);

        const canvas = document.getElementById('gameCanvas');
        if (canvas) {
            canvas.style.display = 'block';
            resizeCanvas();
        }

        initGame();
        gameStarted = false;
        removeGameEventListeners();
        startRenderLoop(); // sayım sırasında sahneyi çizmeye başla

        // Geri sayımı başlat, bitince hazır sinyali gönder
        showStartCountdown(() => {
            startGameplay();
        });
    }

    // Show start countdown animation — each number pops in with scale + glow
    function showStartCountdown(callback) {
        const countdownDiv = document.getElementById('startCountdown');
        // [text, color, animation, fontSize]
        const steps = [
            ['Hazır ol!', '#ffffff', 'countdownPop 0.6s ease-out forwards', '3.2rem'],
            ['3',         '#ff4444', 'countdownPop 0.5s ease-out forwards', '7rem'],
            ['2',         '#ffaa00', 'countdownPop 0.5s ease-out forwards', '7rem'],
            ['1',         '#44ff44', 'countdownPop 0.5s ease-out forwards', '7rem'],
            ['BAŞLA!',    '#39ff14', 'countdownGo  0.55s ease-out forwards', '5rem'],
        ];
        let i = 0;
        gameStarted = false;

        function showStep(idx) {
            const [text, color, anim, size] = steps[idx];
            countdownDiv.style.display = 'flex';
            countdownDiv.style.opacity = '1';
            countdownDiv.style.color = color;
            countdownDiv.style.fontSize = size;
            countdownDiv.style.animation = 'none';
            void countdownDiv.offsetWidth; // force reflow so animation restarts
            countdownDiv.style.animation = anim;
            countdownDiv.textContent = text;
        }

        showStep(0);

        function next() {
            i++;
            if (i < steps.length) {
                showStep(i);
                const delay = i === steps.length - 1 ? 700 : 900;
                if (i < steps.length - 1) {
                    setTimeout(next, delay);
                } else {
                    // "BAŞLA!" — brief pause then fade out
                    setTimeout(() => {
                        countdownDiv.style.opacity = '0';
                        setTimeout(() => {
                            countdownDiv.style.display = 'none';
                            countdownDiv.style.opacity = '1';
                            countdownDiv.style.animation = 'none';
                            countdownDiv.textContent = '';
                            if (callback) callback();
                        }, 350);
                    }, 600);
                }
            }
        }
        setTimeout(next, 1100);
    }

    // Socket event handlers for player names
    socket.on('playerJoined', (data) => {
        console.log('Player joined:', data);
        if (data.playerNumber !== playerNumber) {
            opponentName = data.playerName;
        }
    });

    // Handle player name submission
    function submitName() {
        const nameInput = document.getElementById('playerNameInput');
        const name = nameInput.value.trim();
        
        if (name.length < 2) {
            alert('Please enter a name with at least 2 characters');
            return;
        }
        
        playerName = name;
        
        // Hide name form and show menu
        document.getElementById('nameForm').style.display = 'none';
        document.getElementById('menu').style.display = 'block';
        
        // iOS için özel fokus yönetimi
        const roomIdInput = document.getElementById('roomId');
        if (roomIdInput) {
            // iOS için hem click hem touch event ekleyelim
            const focusRoomInput = () => {
                // Kısa bir gecikme ile fokuslanma
                setTimeout(() => {
                    roomIdInput.focus();
                    // iOS için ek olarak tıklama simülasyonu
                    roomIdInput.click();
                }, 300);
            };

            // İlk fokuslanma denemesi
            focusRoomInput();

            // Menü görünür olduğunda tekrar deneyelim
            const menuElement = document.getElementById('menu');
            if (menuElement) {
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.target.style.display === 'block') {
                            focusRoomInput();
                        }
                    });
                });

                observer.observe(menuElement, {
                    attributes: true,
                    attributeFilter: ['style']
                });
            }
        }
    }

    // Event Listeners
    const submitNameBtn = document.getElementById('submitNameBtn');
    if (submitNameBtn) {
        submitNameBtn.addEventListener('click', submitName);
    }

    const createRoomBtn = document.getElementById('createRoomBtn');
    if (createRoomBtn) {
        createRoomBtn.addEventListener('click', createRoom);
    }

    const botPlayBtn = document.getElementById('botPlayBtn');
    if (botPlayBtn) {
        botPlayBtn.addEventListener('click', createBotRoom);
    }

    const quickPlayBtn = document.getElementById('quickPlayBtn');
    if (quickPlayBtn) {
        quickPlayBtn.addEventListener('click', startQuickMatch);
    }

    const backToNameBtn = document.getElementById('backToNameBtn');
    if (backToNameBtn) {
        backToNameBtn.addEventListener('click', () => {
            // Menüye dönerken yeniden bağlanmayı tetikleme
            hasJoinedGame = false;
            gamePaused = false;
            renderRunning = false;
            hideOverlay();

            // Socket bağlantısını kapat
            if (socket) {
                socket.disconnect();
            }

            // Oyun durumunu sıfırla
            playerNumber = null;
            roomId = null;
            gameStarted = false;
            score = { player1: 0, player2: 0 };
            opponentName = "Bekleniyor...";
            
            // Tüm menüleri gizle
            const menu = document.getElementById('menu');
            const scoreLimitPopup = document.getElementById('scoreLimitPopup');
            const waitingRoom = document.getElementById('waitingRoom');
            const mainMenu = document.getElementById('mainMenu');
            
            if (menu) menu.style.display = 'none';
            if (scoreLimitPopup) scoreLimitPopup.style.display = 'none';
            if (waitingRoom) waitingRoom.style.display = 'none';
            if (mainMenu) mainMenu.style.display = 'block';
            
            // İsim formunu göster
            const nameForm = document.getElementById('nameForm');
            if (nameForm) {
                nameForm.style.display = 'flex';
                // İsim inputunu temizle ve fokusla
                const nameInput = document.getElementById('playerNameInput');
                if (nameInput) {
                    nameInput.value = '';
                    nameInput.focus();
                }
            }
            
            // Canvas'ı gizle
            const canvas = document.getElementById('gameCanvas');
            if (canvas) canvas.style.display = 'none';
            
            // Sayfa yenileme olmadan sayfayı ilk haline getir
            window.scrollTo(0, 0);
            document.body.style.overflow = 'hidden';

            // Yeni socket bağlantısı oluştur
            socket.connect();
        });
    }

    const confirmScoreLimitBtn = document.getElementById('confirmScoreLimit');
    if (confirmScoreLimitBtn) {
        confirmScoreLimitBtn.addEventListener('click', confirmScoreAndCreateRoom);
    }

    const joinRoomBtn = document.getElementById('joinRoomBtn');
    if (joinRoomBtn) {
        joinRoomBtn.addEventListener('click', joinRoom);
    }

    const copyRoomBtn = document.getElementById('copyRoomBtn');
    if (copyRoomBtn) {
        copyRoomBtn.addEventListener('click', () => {
            const roomCode = document.getElementById('currentRoomId').textContent;
            navigator.clipboard.writeText(roomCode).then(() => {
                const toast = document.getElementById('toast');
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                }, 2000);
            });
        });
    }

    const shareRoomBtn = document.getElementById('shareRoomBtn');
    if (shareRoomBtn) {
        shareRoomBtn.addEventListener('click', async () => {
            const roomCode = document.getElementById('currentRoomId').textContent;
            const shareText = `Hava hokeyi oynayalım! Oda kodu: ${roomCode}`;
            if (navigator.share) {
                try { await navigator.share({ title: 'Air Hockey', text: shareText }); } catch (e) {}
            } else {
                // Fallback: WhatsApp deeplink
                window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
            }
        });
    }

    const playerNameInput = document.getElementById('playerNameInput');
    if (playerNameInput) {
        playerNameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitName();
            }
        });
    }

    const roomIdInput = document.getElementById('roomId');
    if (roomIdInput) {
        roomIdInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                joinRoom();
            }
        });
    }

    // Game loop
    // Handle both mouse and touch movement — send paddle input to the authoritative server,
    // and move our own paddle locally for instant feedback (the server reconciles it).
    function handleMove(e) {
        // Oyun başlamadıysa veya duraklatıldıysa hiçbir şey yapma
        if (!gameStarted || gamePaused) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;
        if (e.type.startsWith('touch')) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        let mouseX = clientX - rect.left;
        let mouseY = clientY - rect.top;

        // Player 2 ekranı 180° döndürülmüş; girdiyi oyun-uzayına çevir
        if (playerNumber === 2) {
            mouseX = canvas.width - mouseX;
            mouseY = canvas.height - mouseY;
        }

        // Kendi sahamıza göre sınırla (server da aynı sınırı uygular)
        const targetX = Math.min(Math.max(mouseX, PADDLE_RADIUS), canvas.width - PADDLE_RADIUS);
        let targetY;
        if (playerNumber === 1) {
            targetY = (courtType === 'half')
                ? Math.min(Math.max(mouseY, canvas.height / 2), canvas.height - PADDLE_RADIUS)
                : Math.min(Math.max(mouseY, PADDLE_RADIUS), canvas.height - PADDLE_RADIUS);
            paddle1.x = targetX; paddle1.y = targetY;     // lokal tahmin
        } else {
            targetY = (courtType === 'half')
                ? Math.min(Math.max(mouseY, PADDLE_RADIUS), canvas.height / 2)
                : Math.min(Math.max(mouseY, PADDLE_RADIUS), canvas.height - PADDLE_RADIUS);
            paddle2.x = targetX; paddle2.y = targetY;     // lokal tahmin
        }

        // Server'a normalize girdi gönder
        const rel = canvasToRelative(targetX, targetY);
        socket.emit('input', { roomId, x: rel.x, y: rel.y });
    }


    // Event listener'ları ekle
    function addGameEventListeners() {
        canvas.addEventListener('mousemove', handleMove);
        canvas.addEventListener('touchmove', handleMove, { passive: false });
        canvas.addEventListener('touchstart', handleMove, { passive: false });
        document.addEventListener('touchmove', preventDefaultTouch, { passive: false });
    }

    // Event listener'ları kaldır
    function removeGameEventListeners() {
        canvas.removeEventListener('mousemove', handleMove);
        canvas.removeEventListener('touchmove', handleMove);
        canvas.removeEventListener('touchstart', handleMove);
        document.removeEventListener('touchmove', preventDefaultTouch);
    }

    // Touch event'leri için prevent default
    function preventDefaultTouch(e) {
        e.preventDefault();
    }

    // İlk yüklemede event listener'ları kaldır
    removeGameEventListeners();

    // Room management functions
    function createRoom() {
        pendingBotMode = false;
        openSettingsPopup();
    }

    // Single-player: open the same settings popup but reveal the difficulty selector
    function createBotRoom() {
        pendingBotMode = true;
        openSettingsPopup();
    }

    // Show the settings popup; difficulty selector is only visible in bot mode
    function openSettingsPopup() {
        const popup = document.getElementById('scoreLimitPopup');
        const mainMenu = document.getElementById('mainMenu');
        const difficultyGroup = document.getElementById('difficultyGroup');

        if (difficultyGroup) difficultyGroup.style.display = pendingBotMode ? 'block' : 'none';
        if (popup) popup.style.display = 'flex';
        if (mainMenu) mainMenu.style.display = 'none';
    }

    // Skor limit seçimini onayla ve oda oluştur
    function confirmScoreAndCreateRoom() {
        const popup = document.getElementById('scoreLimitPopup');
        const scoreLimitSelect = document.getElementById('scoreLimitSelect');
        const courtTypeSelect = document.getElementById('courtTypeSelect');
        const selectedScoreLimit = parseInt(scoreLimitSelect.value);
        const selectedCourtType = courtTypeSelect.value;
        
        console.log('Seçilen skor limiti:', selectedScoreLimit);
        console.log('Seçilen saha tipi:', selectedCourtType);
        
        // Popup'ı gizle
        popup.style.display = 'none';

        // Global değişkenleri güncelle
        scoreLimit = selectedScoreLimit;
        courtType = selectedCourtType;

        // Socket bağlantısını kontrol et
        if (!socket.connected) {
            console.log('Socket not connected, reconnecting...');
            socket.connect();
        }

        if (pendingBotMode) {
            // Tek oyuncu: bot odası iste
            const difficultySelect = document.getElementById('difficultySelect');
            const difficulty = difficultySelect ? difficultySelect.value : 'medium';
            console.log('Creating BOT room, difficulty:', difficulty);
            setTimeout(() => {
                socket.emit('createBotRoom', {
                    playerName: playerName,
                    scoreLimit: selectedScoreLimit,
                    courtType: selectedCourtType,
                    difficulty: difficulty
                });
            }, 300);
            return;
        }

        // Çok oyuncu: normal oda oluştur
        console.log('Creating room with score limit:', selectedScoreLimit, 'and court type:', selectedCourtType);
        const roomCode = Math.floor(Math.random() * 9000 + 1000).toString();
        setTimeout(() => {
            socket.emit('createRoom', {
                roomId: roomCode,
                playerName: playerName,
                scoreLimit: selectedScoreLimit,
                courtType: selectedCourtType
            });
        }, 500);
    }

    function joinRoom() {
        const roomIdInput = document.getElementById('roomId').value;
        if (roomIdInput) {
            console.log('Attempting to join room:', roomIdInput);
            socket.emit('joinRoom', { 
                roomId: roomIdInput,
                playerName: playerName
            });
        } else {
            alert('Please enter a Room ID');
        }
    }

    // Update score without using HTML element
    function updateScore() {
        // No need to do anything here, scores are drawn in the draw function
    }

    // Socket connection handlers
    socket.on('connect', () => {
        console.log('Connected to server, Player:', playerNumber);
        isConnected = true;
        // Kendi sayacını iptal et; bağlantı geri geldi
        if (selfDisconnectCancel) { selfDisconnectCancel(); selfDisconnectCancel = null; }

        // Eğer zaten bir oyundaysak ve bağlantı koptuktan sonra geri geldiysek odaya yeniden katıl (#3)
        if (hasJoinedGame && roomId && playerNumber) {
            socket.emit('rejoinRoom', { roomId, playerNumber, playerName });
        }
    });

    let selfDisconnectCancel = null;
    socket.on('disconnect', () => {
        console.log('Disconnected from server, Player:', playerNumber);
        isConnected = false;
        if (hasJoinedGame) {
            gamePaused = true;
            if (selfDisconnectCancel) selfDisconnectCancel();
            selfDisconnectCancel = startOverlayCountdown(
                'Bağlantı koptu\nYeniden bağlanılıyor...',
                () => {
                    // Grace period expired on our end — nothing left to wait for
                    selfDisconnectCancel = null;
                    showOverlay('Bağlantı kurulamadı.\nSayfayı yenileyin.');
                }
            );
        }
    });

    // Rakip geçici olarak koptu — geri sayım overlay'i göster
    socket.on('opponentDisconnected', () => {
        gamePaused = true;
        if (reconnectCountdownTimer) { reconnectCountdownTimer(); reconnectCountdownTimer = null; }
        reconnectCountdownTimer = startOverlayCountdown(
            'Rakibin bağlantısı koptu\nGeri dönmesi bekleniyor...',
            () => { reconnectCountdownTimer = null; }
        );
    });

    // Rakip geri döndü
    socket.on('opponentReconnected', () => {
        gamePaused = false;
        if (reconnectCountdownTimer) { reconnectCountdownTimer(); reconnectCountdownTimer = null; }
        hideOverlay();
    });

    // Biz odaya yeniden katıldık
    socket.on('rejoined', (data) => {
        console.log('Rejoined room:', data);
        if (data && data.scoreLimit) scoreLimit = data.scoreLimit;
        if (data && data.courtType) courtType = data.courtType;
        gamePaused = false;
        hideOverlay();
    });

    // Server is restarting/shutting down — show a clear message instead of a silent hang.
    socket.on('serverRestarting', () => {
        gamePaused = true;
        if (hasJoinedGame) {
            showOverlay('Sunucu yeniden başlatılıyor.\nLütfen birazdan tekrar deneyin.');
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error, Player:', playerNumber, error);
    });

    socket.on('connect_timeout', () => {
        console.error('Connection timeout, Player:', playerNumber);
    });

    socket.on('connected', (data) => {
        console.log('Connection confirmed, ID:', data.id);
    });

    socket.on('roomCreated', (data) => {
        console.log('Room created with data:', data);
        roomId = data.roomId;
        playerNumber = 1;
        gameStarted = false;
        hasJoinedGame = true;

        // scoreLimit zaten createRoom'da atandı, server'dan gelmesini beklemeyelim
        console.log('Using score limit:', scoreLimit);
        
        const menu = document.getElementById('menu');
        const mainMenu = document.getElementById('mainMenu');
        const waitingRoom = document.getElementById('waitingRoom');
        const currentRoomId = document.getElementById('currentRoomId');
        
        if (menu && mainMenu && waitingRoom && currentRoomId) {
            currentRoomId.textContent = roomId;
            mainMenu.style.display = 'none';
            waitingRoom.style.display = 'block';
            menu.style.display = 'block';
        }
    });

    // Single-player: server set up a bot room — skip the waiting room, start at once.
    socket.on('botGameStart', (data) => {
        console.log('Bot game starting:', data);
        roomId = data.roomId;
        playerNumber = 1;
        hasJoinedGame = true;
        gameStarted = false;
        if (data.scoreLimit) scoreLimit = data.scoreLimit;
        if (data.courtType) courtType = data.courtType;
        opponentName = data.botName || 'Bilgisayar';

        // Hide all menus
        const menu = document.getElementById('menu');
        const waitingRoom = document.getElementById('waitingRoom');
        if (waitingRoom) waitingRoom.style.display = 'none';
        if (menu) menu.style.display = 'none';

        startGame();
    });

    // Quick-match: server paired us with a random opponent. 'gameStart' follows and
    // runs the countdown — here we just record who we are and dismiss the search UI.
    socket.on('searchingMatch', () => {
        console.log('Searching for opponent...');
    });

    socket.on('matchFound', (data) => {
        console.log('Match found:', data);
        searching = false;
        hideSearching();
        roomId = data.roomId;
        playerNumber = data.playerNumber;
        opponentName = data.opponentName || 'Rakip';
        if (data.scoreLimit) scoreLimit = data.scoreLimit;
        if (data.courtType) courtType = data.courtType;
        hasJoinedGame = true;
        gameStarted = false;

        const menu = document.getElementById('menu');
        if (menu) menu.style.display = 'none';
    });

    socket.on('roomJoined', (data) => {
        console.log('Room joined, Player:', playerNumber, 'Room:', data.roomId);
        roomId = data.roomId;
        playerNumber = 2;
        opponentName = data.hostName;
        scoreLimit = data.scoreLimit;
        courtType = data.courtType;
        hasJoinedGame = true;

        // Hide menu
        const menu = document.getElementById('menu');
        if (menu) menu.style.display = 'none';
    });

    socket.on('roomError', (message) => {
        console.error('Room error:', message);
        alert(message);
    });

    socket.on('gameStart', () => {
        console.log('Game starting...');
        const menu = document.getElementById('menu');
        const waitingRoom = document.getElementById('waitingRoom');
        const canvas = document.getElementById('gameCanvas');
        
        // Menüleri gizle
        if (menu) menu.style.display = 'none';
        if (waitingRoom) waitingRoom.style.display = 'none';
        
        // Canvas'ı görünür yap
        if (canvas) {
            canvas.style.display = 'block';
            resizeCanvas(); // Canvas'ı yeniden boyutlandır
        }
        
        startGame();
    });

    // Authoritative state snapshot from the server (~60Hz).
    // Puck and opponent paddle land in interpolation targets; renderLoop lerps toward them.
    // Own paddle stays locally predicted for instant feedback.
    socket.on('state', (data) => {
        if (!data) return;

        if (data.puck) {
            const p = relativeToCanvas(data.puck.x, data.puck.y);
            puckTarget.x = p.x; puckTarget.y = p.y;
        }
        if (playerNumber === 1) {
            if (data.p2) { const o = relativeToCanvas(data.p2.x, data.p2.y); oppTarget.x = o.x; oppTarget.y = o.y; }
            if (gamePaused && data.p1) { const s = relativeToCanvas(data.p1.x, data.p1.y); paddle1.x = s.x; paddle1.y = s.y; }
        } else {
            if (data.p1) { const o = relativeToCanvas(data.p1.x, data.p1.y); oppTarget.x = o.x; oppTarget.y = o.y; }
            if (gamePaused && data.p2) { const s = relativeToCanvas(data.p2.x, data.p2.y); paddle2.x = s.x; paddle2.y = s.y; }
        }
        if (data.score) score = data.score;
        if (data.puckSpeed !== undefined) puckSpeed = data.puckSpeed;
    });

    // Server bir gol bildirdi
    socket.on('goal', (data) => {
        if (data && data.score) score = data.score;
        showGoalAnimation(); // animasyon + gol sesi + titreşim
    });

    // Server raket-top çarpışması bildirdi (hangi raketin vurduğu data.player ile gelir)
    socket.on('hit', (data) => {
        const who = (data && data.player) ? data.player : playerNumber;
        hitFlashTime = Date.now();
        hitFlashPlayer = who;            // o rakette parlama göster
        playHitSound();
        // Titreşimi sadece kendi raketimiz vurunca hissettir
        if (who === playerNumber && 'vibrate' in navigator) navigator.vibrate(40);
    });
}); 