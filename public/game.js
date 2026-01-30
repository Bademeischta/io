const socket = io();

// --- DOM ELEMENTE ---
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
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const powerUpNotice = document.getElementById('powerUpNotice');
const spectatorOverlay = document.getElementById('spectatorOverlay');
const mobileControls = document.getElementById('mobileControls');
const joystickBase = document.getElementById('joystickBase');
const joystickHandle = document.getElementById('joystickHandle');
const mobileShoot = document.getElementById('mobileShoot');
const mobileBoost = document.getElementById('mobileBoost');

// --- SPIELZUSTAND ---
let me = null;
let players = [];
let food = [];
let projectiles = [];
let worldSize = { width: 3000, height: 3000 };
let gameActive = false;
let config = {};
let selectedColor = '#FF6B6B';
let particles = [];
let debugMode = false;
let lastFps = 0;
let frameCount = 0;
let lastFpsUpdate = Date.now();
let serverTicks = 0;
let lastTickUpdate = Date.now();
let currentTPS = 0;
let isSpectating = false;
let spectatingId = null;

// --- PERSISTENZ (LocalStorage) ---
let stats = JSON.parse(localStorage.getItem('schoolArena_stats')) || {
    kills: 0, deaths: 0, bestScore: 0, totalScore: 0, games: 0
};
function saveStats() { localStorage.setItem('schoolArena_stats', JSON.stringify(stats)); }
function updateGlobalStatsUI() {
    document.getElementById('ltKills').innerText = stats.kills;
    document.getElementById('ltBestScore').innerText = Math.floor(stats.bestScore);
}
updateGlobalStatsUI();

// --- MOBILE LOGIK ---
let isMobile = false;
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };
let joystickVector = { x: 0, y: 0 };
const JOYSTICK_MAX_DIST = 75;

// --- INTERPOLATION & CAMERA ---
const interpolationBuffer = [];
const RENDER_DELAY = 100;
const camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
let lastUpdateTime = Date.now();

// --- INPUT ---
const mouse = { x: 0, y: 0 };
const keys = { space: false };
let isChatting = false;

// --- INITIALISIERUNG ---
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F06292', '#AED581', '#FFD54F', '#4DB6AC', '#7986CB', '#9575CD', '#FF8A65'];
colors.forEach(color => {
    const btn = document.createElement('button');
    btn.className = 'color-btn';
    btn.style.backgroundColor = color;
    if (color === selectedColor) btn.classList.add('active');
    btn.onclick = () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedColor = color;
    };
    colorPicker.appendChild(btn);
});

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    minimapCanvas.width = 180;
    minimapCanvas.height = 180;
}
window.addEventListener('resize', resize);
resize();

// --- CORE LOOPS ---
function render() {
    const now = Date.now();
    const dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    // FPS Berechnung
    frameCount++;
    if (now - lastFpsUpdate > 1000) {
        lastFps = frameCount;
        frameCount = 0;
        lastFpsUpdate = now;
        currentTPS = serverTicks;
        serverTicks = 0;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameActive && me) {
        predictMe(dt);
        const interpolatedPlayers = getInterpolatedPlayers(now - RENDER_DELAY);

        // Kamera Update
        let targetX = me.x, targetY = me.y, targetRadius = me.radius;
        if (isSpectating) {
            const target = interpolatedPlayers.find(p => p.id === spectatingId);
            if (target) { targetX = target.x; targetY = target.y; targetRadius = target.radius; }
        }

        camera.x += (targetX + (me.vx || 0) * 15 - camera.x) * 0.1;
        camera.y += (targetY + (me.vy || 0) * 15 - camera.y) * 0.1;
        camera.targetZoom = Math.max(0.4, 1 - (targetRadius - 20) / 160);
        camera.zoom += (camera.targetZoom - camera.zoom) * 0.05;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        drawGrid();
        food.forEach(drawFood);
        
        // Partikel
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update(dt);
            particles[i].draw(ctx);
            if (particles[i].lifespan <= 0) particles.splice(i, 1);
        }

        projectiles.forEach(drawProjectile);
        interpolatedPlayers.forEach(p => { if (p.id !== me.id) drawPlayer(p); });
        if (!isSpectating) drawPlayer(me, true);

        if (debugMode) drawDebug();

        ctx.restore();
        drawMinimap(interpolatedPlayers);
        updateUI();
    }

    requestAnimationFrame(render);
}

function predictMe(dt) {
    if (isSpectating) return;

    let dx, dy, dist;

    if (isMobile && joystickActive) {
        dx = joystickVector.x;
        dy = joystickVector.y;
        dist = Math.sqrt(dx * dx + dy * dy);
    } else {
        const worldMouseX = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
        const worldMouseY = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
        dx = worldMouseX - me.x;
        dy = worldMouseY - me.y;
        dist = Math.sqrt(dx * dx + dy * dy);
    }

    let speedMult = (window.DEBUG_SPEED_BOOST || 1.0);
    if (me.powerUps && me.powerUps.includes('speed')) speedMult *= 1.5;

    let speed = config.PLAYER_BASE_SPEED / (1 + me.mass / 500) * speedMult;
    if (keys.space && me.mass > 30) speed *= config.BOOST_MULTIPLIER;

    if (dist > 5) {
        const targetVx = (dx / dist) * speed;
        const targetVy = (dy / dist) * speed;
        me.vx += (targetVx - me.vx) * 0.1;
        me.vy += (targetVy - me.vy) * 0.1;
    } else { me.vx *= 0.95; me.vy *= 0.95; }

    me.x += me.vx; me.y += me.vy;
    me.x = Math.max(me.radius, Math.min(worldSize.width - me.radius, me.x));
    me.y = Math.max(me.radius, Math.min(worldSize.height - me.radius, me.y));

    if (window.DEBUG_GOD_MODE) me.health = me.mass;
}

// --- RENDERING HELPER ---
function drawGrid() {
    const size = 200;
    ctx.beginPath();
    ctx.strokeStyle = '#16213e';
    ctx.lineWidth = 2;
    for (let x = 0; x <= worldSize.width; x += size) { ctx.moveTo(x, 0); ctx.lineTo(x, worldSize.height); }
    for (let y = 0; y <= worldSize.height; y += size) { ctx.moveTo(0, y); ctx.lineTo(worldSize.width, y); }
    ctx.stroke();
    ctx.strokeStyle = '#e94560'; ctx.lineWidth = 10; ctx.strokeRect(0, 0, worldSize.width, worldSize.height);
}

function drawFood(f) {
    ctx.fillStyle = f.color;
    if (f.isPowerUp) {
        ctx.save();
        ctx.shadowBlur = 15; ctx.shadowColor = '#fff';
        ctx.globalAlpha = 0.6 + Math.sin(Date.now() / 200) * 0.4;
    }
    ctx.beginPath();
    if (f.shape === 'square') ctx.rect(f.x - f.radius, f.y - f.radius, f.radius * 2, f.radius * 2);
    else ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fill();
    if (f.isPowerUp) ctx.restore();
}

function drawPlayer(p, isMe = false) {
    ctx.save();
    // Glow
    ctx.shadowBlur = isMe ? 25 : 15;
    if (p.onFire) { ctx.shadowBlur = 20 + Math.sin(Date.now() / 100) * 10; ctx.shadowColor = '#ff6600'; }
    else ctx.shadowColor = p.color;

    // Körper
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Schild
    if (p.powerUps && p.powerUps.includes('shield')) {
        ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 4; ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + 8, Date.now() / 200, Date.now() / 200 + Math.PI * 1.5); ctx.stroke();
    }

    // Health Ring
    const hpPerc = p.health / p.mass;
    ctx.strokeStyle = hpPerc > 0.6 ? '#2ecc71' : (hpPerc > 0.3 ? '#f1c40f' : '#e74c3c');
    ctx.lineWidth = 3; ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 4, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * hpPerc)); ctx.stroke();

    // Name & Level
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(12, p.radius / 2)}px Segoe UI`; ctx.textAlign = 'center';
    let nameTag = p.name + (p.onFire ? ' 🔥' : '');
    ctx.fillText(nameTag, p.x, p.y - p.radius - 20);
    ctx.font = `bold ${Math.max(10, p.radius / 2.5)}px Segoe UI`;
    ctx.fillText(`Lvl ${p.level}`, p.x, p.y - p.radius - 5);
    ctx.restore();
}

function drawProjectile(pr) {
    ctx.fillStyle = pr.color; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;
}

function drawMinimap(allPlayers) {
    mctx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    const scale = minimapCanvas.width / worldSize.width;
    allPlayers.forEach(p => {
        mctx.fillStyle = p.color;
        const size = (me && p.id === me.id) ? 4 : 2;
        mctx.beginPath(); mctx.arc(p.x * scale, p.y * scale, size, 0, Math.PI * 2); mctx.fill();
    });
}

function updateUI() {
    if (!me) return;
    document.getElementById('killCount').innerText = me.kills;
    document.getElementById('onlineCount').innerText = players.length;
    document.getElementById('healthBar').style.width = `${(me.health / me.mass) * 100}%`;
    document.getElementById('healthText').innerText = `${Math.floor(me.health)}/${Math.floor(me.mass)}`;
    
    const curLvlXp = Math.pow(me.level - 1, 2) * 100;
    const nextLvlXp = Math.pow(me.level, 2) * 100;
    const progress = ((me.score - curLvlXp) / (nextLvlXp - curLvlXp)) * 100;
    document.getElementById('xpBar').style.width = `${progress}%`;
    document.getElementById('xpText').innerText = `${Math.floor(me.score)} XP`;
    document.getElementById('levelText').innerText = me.level;
}

function drawDebug() {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(10, 100, 200, 160);
    ctx.fillStyle = '#0f0'; ctx.font = '12px monospace';
    ctx.fillText(`FPS: ${lastFps}`, 20, 120);
    ctx.fillText(`TPS: ${currentTPS}`, 20, 135);
    ctx.fillText(`POS: ${Math.floor(me.x)}, ${Math.floor(me.y)}`, 20, 150);
    ctx.fillText(`MASSE: ${Math.floor(me.mass)}`, 20, 165);
    ctx.fillText(`ZOOM: ${camera.zoom.toFixed(2)}`, 20, 180);
    ctx.fillText(`OBJEKTE: P:${players.length} F:${food.length} Pr:${projectiles.length}`, 20, 195);
    if (window.performance && window.performance.memory) {
        ctx.fillText(`MEM: ${Math.round(window.performance.memory.usedJSHeapSize / 1048576)} MB`, 20, 210);
    }
    ctx.restore();
}

// --- PARTIKEL SYSTEM ---
class Particle {
    constructor(x, y, vx, vy, color, radius, lifespan) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.color = color; this.radius = radius;
        this.lifespan = lifespan; this.maxLifespan = lifespan;
    }
    update(dt) { this.x += this.vx; this.y += this.vy; this.lifespan -= dt * 60; }
    draw(ctx) {
        ctx.save(); ctx.globalAlpha = Math.max(0, this.lifespan / this.maxLifespan);
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}
function spawnExplosion(x, y, color, count = 10, speed = 5, size = 5) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const s = Math.random() * speed;
        particles.push(new Particle(x, y, Math.cos(angle) * s, Math.sin(angle) * s, color, Math.random() * size, 30 + Math.random() * 30));
    }
}

// --- INPUT HANDLING ---

// Touch Erkennung
window.addEventListener('touchstart', () => {
    if (!isMobile) {
        isMobile = true;
        mobileControls.style.display = 'block';
        console.log('[SYSTEM] Touch-Gerät erkannt');
    }
}, { once: true });

// Joystick Logik
joystickBase.addEventListener('touchstart', e => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystickBase.getBoundingClientRect();
    joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
    joystickActive = true;
    updateJoystick(touch);
});

joystickBase.addEventListener('touchmove', e => {
    e.preventDefault();
    if (joystickActive) {
        updateJoystick(e.touches[0]);
    }
});

joystickBase.addEventListener('touchend', e => {
    e.preventDefault();
    joystickActive = false;
    joystickHandle.style.left = '50%';
    joystickHandle.style.top = '50%';
    joystickVector = { x: 0, y: 0 };
    if (gameActive) socket.emit('mouseMove', { x: me.x, y: me.y }); // Stop movement
});

function updateJoystick(touch) {
    let dx = touch.clientX - joystickCenter.x;
    let dy = touch.clientY - joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > JOYSTICK_MAX_DIST) {
        dx = (dx / dist) * JOYSTICK_MAX_DIST;
        dy = (dy / dist) * JOYSTICK_MAX_DIST;
    }

    joystickHandle.style.left = (50 + (dx / JOYSTICK_MAX_DIST) * 50) + '%';
    joystickHandle.style.top = (50 + (dy / JOYSTICK_MAX_DIST) * 50) + '%';

    joystickVector = { x: dx, y: dy };

    if (gameActive && me) {
        // Send move to server (vector based)
        const moveX = me.x + dx * 10;
        const moveY = me.y + dy * 10;
        socket.emit('mouseMove', { x: moveX, y: moveY });
    }
}

// Mobile Buttons
mobileShoot.addEventListener('touchstart', e => {
    e.preventDefault();
    if (gameActive && me) {
        // Shoot in current movement direction or center
        const rad = Math.atan2(joystickVector.y, joystickVector.x);
        const tx = me.x + Math.cos(rad) * 100;
        const ty = me.y + Math.sin(rad) * 100;
        socket.emit('shoot', { targetX: tx, targetY: ty });
    }
});

mobileBoost.addEventListener('touchstart', e => {
    e.preventDefault();
    if (gameActive && me) socket.emit('boost', { active: true });
});

mobileBoost.addEventListener('touchend', e => {
    e.preventDefault();
    if (gameActive && me) socket.emit('boost', { active: false });
});

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', () => {
    if (!gameActive || !me || isChatting) return;
    const wx = (mouse.x - canvas.width / 2) / camera.zoom + camera.x;
    const wy = (mouse.y - canvas.height / 2) / camera.zoom + camera.y;
    socket.emit('shoot', { targetX: wx, targetY: wy });
});
window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isChatting) { keys.space = true; socket.emit('boost', { active: true }); }
    if (e.code === 'Enter') {
        if (!isChatting) {
            isChatting = true; chatInput.style.display = 'block'; chatInput.focus();
        } else {
            if (chatInput.value.trim()) socket.emit('chat', chatInput.value);
            chatInput.value = ''; chatInput.style.display = 'none'; isChatting = false;
        }
    }
    if (e.code === 'Escape' && isChatting) { chatInput.value = ''; chatInput.style.display = 'none'; isChatting = false; }
    if (e.key.toLowerCase() === 'd') debugMode = !debugMode;
    if (e.code === 'Tab' && isSpectating) {
        e.preventDefault();
        const idx = players.findIndex(p => p.id === spectatingId);
        const next = players[(idx + 1) % players.length];
        if (next) { spectatingId = next.id; document.getElementById('spectatingName').innerText = next.name; }
    }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') { keys.space = false; socket.emit('boost', { active: false }); } });

playButton.onclick = () => {
    const name = nameInput.value.trim() || 'Unbekannt';
    socket.emit('joinGame', { name, color: selectedColor });
    startScreen.style.display = 'none'; hud.style.display = 'block'; gameActive = true;
    isSpectating = false; spectatorOverlay.style.display = 'none';
    stats.games++; saveStats();
};

respawnButton.onclick = () => {
    deathScreen.style.display = 'none'; startScreen.style.display = 'flex';
    resetState();
};

function resetState() {
    me = null; players = []; food = []; projectiles = []; particles = [];
    interpolationBuffer.length = 0; gameActive = false;
    camera.x = 0; camera.y = 0; camera.zoom = 1;
}

// --- SOCKET EVENTS ---
socket.on('initGame', data => {
    config = data.config; worldSize = data.worldSize;
    me = { id: data.yourId, x: 0, y: 0, radius: 20, mass: 100, health: 100, score: 0, kills: 0, level: 1 };
});

socket.on('gameUpdate', data => {
    serverTicks++;
    interpolationBuffer.push(data);
    while (interpolationBuffer.length > 10) interpolationBuffer.shift();
    
    food = data.food; projectiles = data.projectiles;
    players = data.players;
    const serverMe = data.players.find(p => p.id === me.id);
    if (serverMe) {
        if (serverMe.boostActive) spawnExplosion(serverMe.x, serverMe.y, serverMe.color, 1, 1, 3);
        me.x += (serverMe.x - me.x) * 0.2; me.y += (serverMe.y - me.y) * 0.2;
        Object.assign(me, serverMe);
    }
});

socket.on('playerDied', data => {
    if (me && data.id === me.id) {
        gameActive = false; deathScreen.style.display = 'flex'; hud.style.display = 'none';
        document.getElementById('finalScore').innerText = Math.floor(data.stats.score);
        document.getElementById('finalLevel').innerText = Math.floor(Math.sqrt(data.stats.score / 100)) + 1;
        document.getElementById('finalKills').innerText = data.stats.kills;
        document.getElementById('killerName').innerText = data.killerName;
        
        // Stats update
        stats.kills += data.stats.kills; stats.deaths++;
        stats.totalScore += data.stats.score;
        if (data.stats.score > stats.bestScore) stats.bestScore = data.stats.score;
        saveStats(); updateGlobalStatsUI();

        let timeLeft = 3; respawnButton.disabled = true;
        const timer = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) { clearInterval(timer); respawnButton.disabled = false; respawnButton.innerText = 'ERNEUT SPIELEN'; }
            else respawnButton.innerText = `ERNEUT SPIELEN (${timeLeft}s)`;
        }, 1000);

        // Spectator start
        isSpectating = true;
        const other = players.find(p => p.id !== me.id);
        if (other) {
            spectatingId = other.id; spectatorOverlay.style.display = 'block';
            document.getElementById('spectatingName').innerText = other.name;
        }
    } else {
        const victim = players.find(p => p.id === data.id);
        if (victim) spawnExplosion(victim.x, victim.y, victim.color, 30, 8, 10);
    }
});

socket.on('chat', data => {
    const msg = document.createElement('div'); msg.className = 'chat-msg';
    msg.innerHTML = `<span style="color:${data.color}; font-weight:bold">${data.name}:</span> ${data.message}`;
    chatMessages.prepend(msg);
    setTimeout(() => msg.style.opacity = '0.5', 10000);
    if (chatMessages.childNodes.length > 20) chatMessages.lastChild.remove();
});

socket.on('systemMessage', data => {
    const msg = document.createElement('div'); msg.className = 'chat-msg';
    msg.style.color = data.color; msg.style.fontStyle = 'italic'; msg.innerText = data.text;
    chatMessages.prepend(msg);
    if (data.text.includes('ERHALTEN')) {
        powerUpNotice.innerText = data.text; powerUpNotice.style.color = data.color;
        setTimeout(() => { if (powerUpNotice.innerText === data.text) powerUpNotice.innerText = ''; }, 3000);
    }
});

socket.on('leaderboardUpdate', data => {
    const list = document.getElementById('leaderboardList'); list.innerHTML = '';
    data.slice(0, 5).forEach((entry, i) => {
        const li = document.createElement('li'); if (me && entry.name === me.name) li.className = 'me';
        li.innerHTML = `<span>${i + 1}. ${entry.name}${entry.isBot ? ' 🤖' : ''}</span> <span>${Math.floor(entry.score)}</span>`;
        list.appendChild(li);
    });
});

socket.on('error', msg => alert(msg));

setInterval(() => {
    const start = Date.now();
    socket.emit('ping', () => { document.getElementById('ping').innerText = Date.now() - start; });
}, 2000);
socket.on('ping', cb => { if (typeof cb === 'function') cb(); });

function getInterpolatedPlayers(renderTime) {
    if (interpolationBuffer.length < 2) return players;
    let i = 0;
    for (; i < interpolationBuffer.length - 1; i++) { if (interpolationBuffer[i + 1].timestamp > renderTime) break; }
    const snap0 = interpolationBuffer[i], snap1 = interpolationBuffer[i + 1];
    if (snap0 && snap1 && renderTime >= snap0.timestamp && renderTime <= snap1.timestamp) {
        const t = (renderTime - snap0.timestamp) / (snap1.timestamp - snap0.timestamp);
        return snap1.players.map(p1 => {
            const p0 = snap0.players.find(p => p.id === p1.id);
            if (!p0) return p1;
            return { ...p1, x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, radius: p0.radius + (p1.radius - p0.radius) * t, health: p0.health + (p1.health - p0.health) * t };
        });
    }
    return players;
}

// --- DEBUG COMMANDS ---
window.DEBUG_GOD_MODE = false;
window.DEBUG_SPEED_BOOST = 1.0;
window.DEBUG_TELEPORT = (x, y) => { if (me) { me.x = x; me.y = y; } };
window.DEBUG_SPAWN_BOT = () => socket.emit('debugSpawnBot');

requestAnimationFrame(render);
