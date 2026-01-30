// CONFIGURATION
const CONFIG = {
    WORLD_WIDTH: 3000,
    WORLD_HEIGHT: 3000,
    PLAYER_BASE_SPEED: 4,
    SERVER_TICKRATE: 20,
    CLIENT_FPS: 60,
    MINIMAP_SIZE: 200,
};

// GAME STATE
const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mctx = minimapCanvas.getContext('2d');

let myId = null;
let players = {};
let food = [];
let projectiles = [];
let particles = [];
let leaderboard = [];

let camera = { x: 0, y: 0, zoom: 1 };
let targetZoom = 1;

let lastUpdateTimestamp = Date.now();
let interpolationBuffer = [];

// UI ELEMENTS
const startScreen = document.getElementById('startScreen');
const gameHUD = document.getElementById('gameHUD');
const deathScreen = document.getElementById('deathScreen');
const nameInput = document.getElementById('nameInput');
const playButton = document.getElementById('playButton');
const colorBtns = document.querySelectorAll('.color-btn');
const respawnButton = document.getElementById('respawnButton');

let selectedColor = '#FF6B6B';
let isAlive = false;
let survivalStartTime = 0;
let totalDeaths = 0;

// INPUT STATE
const keys = {
    space: false
};
const mouse = {
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0
};

// INITIALISIERUNG
function init() {
    resize();
    window.addEventListener('resize', resize);

    // Farbauswahl
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedColor = btn.dataset.color;
        });
    });

    playButton.addEventListener('click', joinGame);
    respawnButton.addEventListener('click', () => {
        deathScreen.style.display = 'none';
        startScreen.style.display = 'block';
    });

    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        updateWorldMouse();

        if (isAlive) {
            socket.emit('mouseMove', { x: mouse.worldX, y: mouse.worldY });
        }
    });

    window.addEventListener('mousedown', (e) => {
        if (isAlive && e.button === 0) {
            socket.emit('shoot', { targetX: mouse.worldX, targetY: mouse.worldY });
            createShootParticles(players[myId]);
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            keys.space = true;
            if (isAlive) socket.emit('boost', true);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            keys.space = false;
            if (isAlive) socket.emit('boost', false);
        }
    });

    requestAnimationFrame(gameLoop);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    minimapCanvas.width = CONFIG.MINIMAP_SIZE;
    minimapCanvas.height = CONFIG.MINIMAP_SIZE;
}

function updateWorldMouse() {
    mouse.worldX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
    mouse.worldY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
}

function joinGame() {
    const name = nameInput.value.trim() || 'Anonym';
    socket.emit('joinGame', { name, color: selectedColor });
    startScreen.style.display = 'none';
    gameHUD.style.display = 'block';
    isAlive = true;
    survivalStartTime = Date.now();
}

// SOCKET HANDLERS
socket.on('initGame', (data) => {
    myId = data.yourId;
    food = data.food;
});

socket.on('gameUpdate', (data) => {
    // Interpolations-Buffer füllen
    interpolationBuffer.push({
        timestamp: data.timestamp,
        players: data.players,
        projectiles: data.projectiles
    });

    // Futter aktualisieren
    food = data.food;

    // Nur die letzten 100ms behalten
    if (interpolationBuffer.length > 10) {
        interpolationBuffer.shift();
    }

    // Ping berechnen
    document.getElementById('pingVal').innerText = Date.now() - data.timestamp;
    document.getElementById('onlineCount').innerText = data.players.length;
});

socket.on('leaderboardUpdate', (data) => {
    leaderboard = data;
    updateLeaderboardUI();
});

socket.on('playerDied', (data) => {
    isAlive = false;
    totalDeaths++;
    gameHUD.style.display = 'none';
    deathScreen.style.display = 'block';

    document.getElementById('finalSurvivalTime').innerText = formatTime(data.yourStats.survivalTime);
    document.getElementById('finalScore').innerText = data.yourStats.score + ' XP';
    document.getElementById('finalLevel').innerText = Math.floor(Math.sqrt(data.yourStats.score / 100)) + 1;
    document.getElementById('finalKills').innerText = data.yourStats.kills;
    document.getElementById('killerName').innerText = data.killerName;

    // Respawn Button Timer
    let timeLeft = 3;
    respawnButton.disabled = true;
    respawnButton.innerText = `ERNEUT SPIELEN (${timeLeft}s)`;

    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(timer);
            respawnButton.disabled = false;
            respawnButton.innerText = 'ERNEUT SPIELEN';
        } else {
            respawnButton.innerText = `ERNEUT SPIELEN (${timeLeft}s)`;
        }
    }, 1000);

    createDeathExplosion(players[myId]);
});

// PARTIKEL SYSTEM
function createShootParticles(player) {
    if (!player) return;
    const angle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
    for (let i = 0; i < 8; i++) {
        particles.push({
            x: player.x + Math.cos(angle) * player.radius,
            y: player.y + Math.sin(angle) * player.radius,
            vx: (Math.cos(angle) + (Math.random() - 0.5)) * 5,
            vy: (Math.sin(angle) + (Math.random() - 0.5)) * 5,
            radius: 2,
            color: player.color,
            life: 0.5,
            maxLife: 0.5
        });
    }
}

function createDeathExplosion(player) {
    if (!player) return;
    for (let i = 0; i < 40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 10;
        particles.push({
            x: player.x,
            y: player.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: Math.random() * 10 + 5,
            color: player.color,
            life: 2.0,
            maxLife: 2.0
        });
    }
}

function createBoostTrail(player) {
    if (!player || !player.boostActive) return;
    particles.push({
        x: player.x,
        y: player.y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        radius: 5,
        color: player.color,
        life: 1.0,
        maxLife: 1.0,
        opacity: 0.5
    });
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

// INTERPOLATION
function getInterpolatedState() {
    const renderTime = Date.now() - 100; // 100ms Interpolations-Delay

    if (interpolationBuffer.length < 2) return null;

    // Finde die zwei States, zwischen denen wir uns befinden
    let i = 0;
    for (i = 0; i < interpolationBuffer.length - 1; i++) {
        if (interpolationBuffer[i + 1].timestamp > renderTime) break;
    }

    const s0 = interpolationBuffer[i];
    const s1 = interpolationBuffer[i + 1];

    if (!s0 || !s1) return interpolationBuffer[interpolationBuffer.length - 1];

    const t = (renderTime - s0.timestamp) / (s1.timestamp - s0.timestamp);

    const interpPlayers = s1.players.map(p1 => {
        const p0 = s0.players.find(p => p.id === p1.id);
        if (!p0) return p1;

        return {
            ...p1,
            x: p0.x + (p1.x - p0.x) * t,
            y: p0.y + (p1.y - p0.y) * t,
            radius: p0.radius + (p1.radius - p0.radius) * t,
            health: p0.health + (p1.health - p0.health) * t,
            mass: p0.mass + (p1.mass - p0.mass) * t
        };
    });

    return { players: interpPlayers, projectiles: s1.projectiles };
}

// UI UPDATES
function updateLeaderboardUI() {
    const list = document.getElementById('leaderboardList');
    list.innerHTML = '';
    leaderboard.forEach((entry, index) => {
        const li = document.createElement('li');
        if (entry.id === myId) li.className = 'me-highlight';
        li.innerText = `${entry.name}: ${entry.score}`;
        list.appendChild(li);
    });
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateHUD(me) {
    if (!me) return;

    document.getElementById('killCount').innerText = me.kills;
    document.getElementById('deathCount').innerText = totalDeaths;
    document.getElementById('survivalTime').innerText = formatTime(Math.floor((Date.now() - survivalStartTime) / 1000));
    document.getElementById('levelVal').innerText = me.level;

    const healthPercent = (me.health / me.mass) * 100;
    const healthBar = document.getElementById('healthBar');
    healthBar.style.width = healthPercent + '%';
    document.getElementById('healthText').innerText = `${Math.floor(me.health)} / ${Math.floor(me.mass)}`;

    // Health Bar Farbe
    if (healthPercent > 66) healthBar.style.background = 'linear-gradient(90deg, #2ecc71, #27ae60)';
    else if (healthPercent > 33) healthBar.style.background = 'linear-gradient(90deg, #f1c40f, #f39c12)';
    else healthBar.style.background = 'linear-gradient(90deg, #e74c3c, #c0392b)';

    // XP Bar
    const currentLevelXP = (me.level - 1) ** 2 * 100;
    const nextLevelXP = (me.level) ** 2 * 100;
    const xpInLevel = me.score - currentLevelXP;
    const xpNeeded = nextLevelXP - currentLevelXP;
    const xpPercent = Math.min(100, (xpInLevel / xpNeeded) * 100);

    document.getElementById('xpBar').style.width = xpPercent + '%';
    document.getElementById('xpText').innerText = `${me.score} XP`;
}

// RENDERING
function drawPlayer(p) {
    ctx.save();

    // Glow
    ctx.shadowBlur = p.id === myId ? 25 : 15;
    ctx.shadowColor = p.color;

    // Body
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    // Health Ring
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius - 2.5, 0, Math.PI * 2);
    ctx.stroke();

    const healthPercent = p.health / p.mass;
    ctx.strokeStyle = healthPercent > 0.66 ? '#2ecc71' : (healthPercent > 0.33 ? '#f1c40f' : '#e74c3c');
    if (healthPercent < 0.25 && Math.floor(Date.now() / 200) % 2 === 0) {
        ctx.strokeStyle = 'white'; // Pulsieren bei wenig Leben
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius - 2.5, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * healthPercent));
    ctx.stroke();

    // Name & Level
    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.max(12, p.radius / 2)}px Segoe UI`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.strokeText(p.name, p.x, p.y - p.radius - 10);
    ctx.fillText(p.name, p.x, p.y - p.radius - 10);

    ctx.font = `bold ${Math.max(10, p.radius / 2.5)}px Segoe UI`;
    ctx.strokeText(`Lvl ${p.level}`, p.x, p.y + 5);
    ctx.fillText(`Lvl ${p.level}`, p.x, p.y + 5);

    // Kill-Streak Badge
    if (p.killStreak >= 3) {
        ctx.fillStyle = '#f1c40f';
        ctx.font = 'bold 12px Segoe UI';
        ctx.strokeText('🔥 ON FIRE!', p.x, p.y + p.radius + 15);
        ctx.fillText('🔥 ON FIRE!', p.x, p.y + p.radius + 15);
    }

    ctx.restore();
}

function drawFood() {
    food.forEach(f => {
        // Culling: Nur im Viewport zeichnen
        if (f.x + f.radius < camera.x - canvas.width / 2 / camera.zoom ||
            f.x - f.radius > camera.x + canvas.width / 2 / camera.zoom ||
            f.y + f.radius < camera.y - canvas.height / 2 / camera.zoom ||
            f.y - f.radius > camera.y + canvas.height / 2 / camera.zoom) return;

        ctx.fillStyle = f.color;
        ctx.beginPath();
        if (f.shape === 'circle') ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        else if (f.shape === 'square') ctx.rect(f.x - f.radius, f.y - f.radius, f.radius * 2, f.radius * 2);
        else if (f.shape === 'triangle') {
            ctx.moveTo(f.x, f.y - f.radius);
            ctx.lineTo(f.x + f.radius, f.y + f.radius);
            ctx.lineTo(f.x - f.radius, f.y + f.radius);
            ctx.closePath();
        } else { // pentagon
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
                const px = f.x + Math.cos(angle) * f.radius;
                const py = f.y + Math.sin(angle) * f.radius;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
        }
        ctx.fill();
    });
}

function drawProjectiles() {
    projectiles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    });
}

function drawParticles() {
    particles.forEach(p => {
        ctx.globalAlpha = (p.life / p.maxLife) * (p.opacity || 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;
}

function drawGrid() {
    const size = 50;
    const startX = Math.floor((camera.x - canvas.width / 2 / camera.zoom) / size) * size;
    const endX = Math.ceil((camera.x + canvas.width / 2 / camera.zoom) / size) * size;
    const startY = Math.floor((camera.y - canvas.height / 2 / camera.zoom) / size) * size;
    const endY = Math.ceil((camera.y + canvas.height / 2 / camera.zoom) / size) * size;

    ctx.strokeStyle = '#16213e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += size) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += size) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();

    // Map Border
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 20;
    ctx.strokeRect(0, 0, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
}

function drawMinimap(me) {
    mctx.clearRect(0, 0, CONFIG.MINIMAP_SIZE, CONFIG.MINIMAP_SIZE);
    const scale = CONFIG.MINIMAP_SIZE / CONFIG.WORLD_WIDTH;

    // Alle Spieler
    for (const id in players) {
        const p = players[id];
        mctx.fillStyle = p.color;
        const size = p.id === myId ? 6 : 4;
        mctx.beginPath();
        mctx.arc(p.x * scale, p.y * scale, size, 0, Math.PI * 2);
        mctx.fill();

        if (p.id === myId) {
            mctx.strokeStyle = 'white';
            mctx.lineWidth = 2;
            mctx.stroke();
        }
    }
}

// GAME LOOP
let lastFrameTime = Date.now();
function gameLoop() {
    const now = Date.now();
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    const state = getInterpolatedState();
    if (state) {
        // Spieler-Daten aus dem interpolierten State übernehmen
        const newPlayers = {};
        state.players.forEach(p => {
            newPlayers[p.id] = p;
            if (p.id === myId) {
                // Kamera folgt dem Spieler mit leichter Antizipation der Bewegungsrichtung
                const anticipation = 15;
                camera.x += (p.x + p.vx * anticipation - camera.x) * 0.1;
                camera.y += (p.y + p.vy * anticipation - camera.y) * 0.1;

                // Dynamischer Zoom basierend auf der Spielergröße
                targetZoom = Math.max(0.4, 1 - (p.radius - 20) / 160);
                camera.zoom += (targetZoom - camera.zoom) * 0.05;

                updateHUD(p);
                createBoostTrail(p);
            }
        });
        players = newPlayers;
        projectiles = state.projectiles;
    }

    updateParticles(dt);
    updateWorldMouse();

    // Render Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply Camera
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    drawFood();
    drawProjectiles();

    for (const id in players) {
        drawPlayer(players[id]);
    }

    drawParticles();

    ctx.restore();

    if (players[myId]) {
        drawMinimap(players[myId]);
    }

    requestAnimationFrame(gameLoop);
}

// START
init();
