const socket = io();

// DOM Elemente
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('startScreen');
const nameInput = document.getElementById('nameInput');
const colorPicker = document.getElementById('colorPicker');
const playButton = document.getElementById('playButton');
const hud = document.getElementById('hud');
const deathScreen = document.getElementById('deathScreen');
const respawnButton = document.getElementById('respawnButton');
const minimapCanvas = document.getElementById('minimap');
const mctx = minimapCanvas.getContext('2d');

// Spielzustand
let me = null;
let players = [];
let food = [];
let projectiles = [];
let worldSize = { width: 3000, height: 3000 };
let gameActive = false;
let config = {};
let selectedColor = '#FF6B6B';
let leaderboard = [];
let particles = [];

// Interpolation & Prediction
let lastUpdateTime = Date.now();
const interpolationBuffer = [];
const RENDER_DELAY = 100; // ms
const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    targetZoom: 1
};

// Input
const mouse = { x: 0, y: 0 };
const keys = { space: false };

// Farben initialisieren
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F06292', '#AED581', '#FFD54F', '#4DB6AC', '#7986CB', '#9575CD', '#FF8A65'];
colors.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.backgroundColor = color;
    btn.dataset.color = color;
    if (color === selectedColor) btn.classList.add('active');
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = color;
    });
    colorPicker.appendChild(btn);
});

// Canvas Größe anpassen
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
}
window.addEventListener('resize', resize);
resize();

// Spiel beitreten
playButton.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Unbekannt';
    socket.emit('joinGame', { name, color: selectedColor });
    startScreen.style.display = 'none';
    hud.style.display = 'block';
    gameActive = true;
});

// Input Handling
window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;

    if (gameActive && me) {
        // Berechne Weltkoordinaten der Maus
        const worldMouseX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
        const worldMouseY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
        socket.emit('mouseMove', { x: worldMouseX, y: worldMouseY });
    }
});

window.addEventListener('mousedown', (e) => {
    if (gameActive && me) {
        const worldMouseX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
        const worldMouseY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
        socket.emit('shoot', { targetX: worldMouseX, targetY: worldMouseY });
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        keys.space = true;
        socket.emit('boost', { active: true });
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        keys.space = false;
        socket.emit('boost', { active: false });
    }
});

// Partikel-System
class Particle {
    constructor(x, y, vx, vy, color, radius, lifespan) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.radius = radius;
        this.maxLifespan = lifespan;
        this.lifespan = lifespan;
    }

    update(dt) {
        this.x += this.vx * dt * 60;
        this.y += this.vy * dt * 60;
        this.lifespan -= dt * 60;
    }

    draw(ctx) {
        const alpha = this.lifespan / this.maxLifespan;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function spawnExplosion(x, y, color, count, speed, size, lifespan) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const s = Math.random() * speed;
        particles.push(new Particle(
            x, y,
            Math.cos(angle) * s,
            Math.sin(angle) * s,
            color,
            Math.random() * size,
            lifespan
        ));
    }
}

// Rendering Loop
function render() {
    const now = Date.now();
    const dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gameActive || !me) {
        requestAnimationFrame(render);
        return;
    }

    // 1. Client-Side Prediction für eigenen Spieler
    predictMe(dt);

    // 2. Interpolation für andere Spieler
    const renderTime = now - RENDER_DELAY;
    const interpolatedPlayers = getInterpolatedPlayers(renderTime);

    // Kamera Update (folgt dem "vorhergesagten" Ich mit Antizipation)
    const targetCamX = me.x + me.vx * 15;
    const targetCamY = me.y + me.vy * 15;
    camera.x += (targetCamX - camera.x) * 0.1;
    camera.y += (targetCamY - camera.y) * 0.1;

    // Zoom berechnen
    camera.targetZoom = Math.max(0.4, 1 - (me.radius - 20) / 160);
    camera.zoom += (camera.targetZoom - camera.zoom) * 0.05;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // 1. Grid zeichnen
    drawGrid();

    // 2. Futter zeichnen
    food.forEach(f => drawFood(f));

    // 3. Partikel zeichnen
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(dt);
        particles[i].draw(ctx);
        if (particles[i].lifespan <= 0) particles.splice(i, 1);
    }

    // 4. Projektile zeichnen
    projectiles.forEach(pr => drawProjectile(pr));

    // 5. Andere Spieler zeichnen
    interpolatedPlayers.forEach(p => {
        if (p.id !== me.id) drawPlayer(p);
    });

    // 5. Eigenen Spieler zeichnen (immer oben)
    drawPlayer(me, true);

    ctx.restore();

    // Minimap & UI
    drawMinimap();
    updateUI();

    requestAnimationFrame(render);
}

function predictMe(dt) {
    if (!me) return;

    // Wir simulieren die Bewegung grob vor, bis das nächste Server-Update kommt
    const worldMouseX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
    const worldMouseY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;

    const dx = worldMouseX - me.x;
    const dy = worldMouseY - me.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let speed = config.PLAYER_BASE_SPEED / (1 + me.mass / 500);
    if (keys.space && me.mass > 30) {
        speed *= config.BOOST_MULTIPLIER;
    }

    if (dist > 5) {
        const targetVx = (dx / dist) * speed;
        const targetVy = (dy / dist) * speed;
        me.vx += (targetVx - me.vx) * 0.1;
        me.vy += (targetVy - me.vy) * 0.1;
    } else {
        me.vx *= 0.95;
        me.vy *= 0.95;
    }

    me.x += me.vx;
    me.y += me.vy;

    // Grenzen checken
    me.x = Math.max(me.radius, Math.min(worldSize.width - me.radius, me.x));
    me.y = Math.max(me.radius, Math.min(worldSize.height - me.radius, me.y));
}

function getInterpolatedPlayers(renderTime) {
    if (interpolationBuffer.length < 2) return players;

    // Finde die zwei Snapshots, zwischen denen die renderTime liegt
    let i = 0;
    for (; i < interpolationBuffer.length - 1; i++) {
        if (interpolationBuffer[i + 1].timestamp > renderTime) break;
    }

    const snap0 = interpolationBuffer[i];
    const snap1 = interpolationBuffer[i + 1];

    if (snap0 && snap1 && renderTime >= snap0.timestamp && renderTime <= snap1.timestamp) {
        const t = (renderTime - snap0.timestamp) / (snap1.timestamp - snap0.timestamp);

        return snap1.players.map(p1 => {
            const p0 = snap0.players.find(p => p.id === p1.id);
            if (!p0) return p1;

            return {
                ...p1,
                x: p0.x + (p1.x - p0.x) * t,
                y: p0.y + (p1.y - p0.y) * t,
                radius: p0.radius + (p1.radius - p0.radius) * t,
                health: p0.health + (p1.health - p0.health) * t
            };
        });
    }

    return players;
}

function drawGrid() {
    const size = 50;
    ctx.beginPath();
    ctx.strokeStyle = '#16213e';
    ctx.lineWidth = 1;

    // Bereich um die Kamera eingrenzen für Performance
    const startX = Math.floor((camera.x - (canvas.width / 2) / camera.zoom) / size) * size;
    const endX = Math.ceil((camera.x + (canvas.width / 2) / camera.zoom) / size) * size;
    const startY = Math.floor((camera.y - (canvas.height / 2) / camera.zoom) / size) * size;
    const endY = Math.ceil((camera.y + (canvas.height / 2) / camera.zoom) / size) * size;

    for (let x = Math.max(0, startX); x <= Math.min(worldSize.width, endX); x += size) {
        ctx.moveTo(x, Math.max(0, startY));
        ctx.lineTo(x, Math.min(worldSize.height, endY));
    }
    for (let y = Math.max(0, startY); y <= Math.min(worldSize.height, endY); y += size) {
        ctx.moveTo(Math.max(0, startX), y);
        ctx.lineTo(Math.min(worldSize.width, endX), y);
    }
    ctx.stroke();

    // Weltgrenze
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, worldSize.width, worldSize.height);
}

function drawFood(f) {
    ctx.fillStyle = f.color;
    ctx.beginPath();
    if (f.shape === 'circle') {
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    } else if (f.shape === 'square') {
        ctx.rect(f.x - f.radius, f.y - f.radius, f.radius * 2, f.radius * 2);
    } else {
        // Vereinfacht für Performance: Rest auch Kreise
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    }
    ctx.fill();
}

function drawPlayer(p, isMe = false) {
    ctx.save();

    // Glow Effekt
    ctx.shadowBlur = isMe ? 25 : 15;
    ctx.shadowColor = p.color;

    // Körper
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Health Ring
    const healthPercent = p.health / p.mass;
    ctx.strokeStyle = healthPercent > 0.66 ? '#2ecc71' : (healthPercent > 0.33 ? '#f1c40f' : '#e74c3c');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 5, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * healthPercent));
    ctx.stroke();

    // Name & Level
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(12, p.radius / 2)}px Segoe UI`;
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - p.radius - 20);
    ctx.fillText(`Lvl ${p.level}`, p.x, p.y - p.radius - 5);

    ctx.restore();
}

function drawProjectile(pr) {
    ctx.fillStyle = pr.color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
}

function drawMinimap() {
    mctx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    const scale = minimapCanvas.width / worldSize.width;

    // Futter (sehr kleine Punkte)
    mctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    food.forEach(f => {
        mctx.fillRect(f.x * scale, f.y * scale, 1, 1);
    });

    // Spieler
    players.forEach(p => {
        mctx.fillStyle = p.color;
        const size = p.id === me.id ? 4 : 2;
        mctx.beginPath();
        mctx.arc(p.x * scale, p.y * scale, size, 0, Math.PI * 2);
        mctx.fill();
    });
}

function updateUI() {
    if (!me) return;

    // Health Bar
    const healthBar = document.getElementById('healthBar');
    const healthText = document.getElementById('healthText');
    const healthPercent = (me.health / me.mass) * 100;
    healthBar.style.width = `${healthPercent}%`;
    healthText.innerText = `${Math.floor(me.health)}/${Math.floor(me.mass)}`;

    healthBar.className = 'bar ' + (healthPercent > 66 ? 'green' : (healthPercent > 33 ? 'yellow' : 'red'));

    // XP Bar
    const xpBar = document.getElementById('xpBar');
    const xpText = document.getElementById('xpText');
    const levelText = document.getElementById('levelText');

    // Level-Fortschritt berechnen
    const currentLevelScore = Math.pow(me.level - 1, 2) * 100;
    const nextLevelScore = Math.pow(me.level, 2) * 100;
    const levelProgress = ((me.score - currentLevelScore) / (nextLevelScore - currentLevelScore)) * 100;

    xpBar.style.width = `${levelProgress}%`;
    xpText.innerText = `${Math.floor(me.score)} XP`;
    levelText.innerText = me.level;

    // Stats
    document.getElementById('killCount').innerText = me.kills;
    document.getElementById('onlineCount').innerText = players.length;
}

// Socket Events
socket.on('initGame', (data) => {
    me = { id: data.yourId, x: 0, y: 0, radius: 20 };
    worldSize = data.worldSize;
    config = data.config;
});

socket.on('gameUpdate', (data) => {
    interpolationBuffer.push(data);
    while (interpolationBuffer.length > 10) interpolationBuffer.shift();

    // Check für neue Projektile (für Mündungsfeuer-Effekt)
    if (data.projectiles.length > projectiles.length) {
        const newProj = data.projectiles[data.projectiles.length - 1];
        if (me && newProj.ownerId === me.id) {
            spawnExplosion(me.x, me.y, me.color, 5, 2, 2, 20);
        }
    }

    projectiles = data.projectiles;
    food = data.food;

    const serverMe = data.players.find(p => p.id === me.id);
    if (serverMe) {
        // Boost Trail
        if (serverMe.boostActive) {
            spawnExplosion(serverMe.x, serverMe.y, serverMe.color, 1, 1, 5, 40);
        }

        // Sanfte Korrektur der vorhergesagten Position (Server-Reconciliation)
        if (me) {
            me.x += (serverMe.x - me.x) * 0.2;
            me.y += (serverMe.y - me.y) * 0.2;
            me.mass = serverMe.mass;
            me.health = serverMe.health;
            me.score = serverMe.score;
            me.kills = serverMe.kills;
            me.level = serverMe.level;
            me.radius = serverMe.radius;
        } else {
            me = serverMe;
        }
    }

    players = data.players;
});

socket.on('leaderboardUpdate', (data) => {
    leaderboard = data;
    const list = document.getElementById('leaderboardList');
    list.innerHTML = '';
    leaderboard.slice(0, 5).forEach((entry, i) => {
        const li = document.createElement('li');
        if (me && entry.name === me.name) li.className = 'me';
        li.innerHTML = `<span>${i + 1}. ${entry.name}</span> <span>${Math.floor(entry.score)}</span>`;
        list.appendChild(li);
    });
});

socket.on('playerDied', (data) => {
    if (me && data.id === me.id) {
        gameActive = false;
        deathScreen.style.display = 'flex';
        hud.style.display = 'none';

        document.getElementById('finalScore').innerText = Math.floor(data.stats.score);
        document.getElementById('finalLevel').innerText = Math.floor(Math.sqrt(data.stats.score / 100)) + 1;
        document.getElementById('finalKills').innerText = data.stats.kills;
        document.getElementById('killerName').innerText = data.killerName;

        // Respawn Timer
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
    } else {
        // Explosion für andere Spieler
        const victim = players.find(p => p.id === data.id);
        if (victim) {
            spawnExplosion(victim.x, victim.y, victim.color, 30, 5, 10, 100);
        }
    }
});

respawnButton.addEventListener('click', () => {
    deathScreen.style.display = 'none';
    startScreen.style.display = 'flex';
});

// Ping Messung
setInterval(() => {
    const start = Date.now();
    socket.emit('ping', () => {
        document.getElementById('ping').innerText = Date.now() - start;
    });
}, 2000);

socket.on('ping', (cb) => {
    if (typeof cb === 'function') cb();
});

requestAnimationFrame(render);
