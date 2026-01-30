const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Statische Dateien servieren
app.use(express.static(path.join(__dirname, 'public')));

// SPIEL-KONFIGURATION
const CONFIG = {
    WORLD_WIDTH: 3000,
    WORLD_HEIGHT: 3000,
    PLAYER_BASE_SPEED: 4,
    PLAYER_START_MASS: 100,
    PLAYER_START_RADIUS: 20,
    PROJECTILE_SPEED: 12,
    PROJECTILE_DAMAGE_BASE: 15,
    PROJECTILE_COST: 5,
    BOOST_MULTIPLIER: 2.5,
    BOOST_COST_PER_SEC: 0.5,
    FOOD_COUNT: 400,
    FOOD_MIN_VALUE: 5,
    FOOD_MAX_VALUE: 20,
    SERVER_TICKRATE: 20, // Updates pro Sekunde an Clients
    PHYSICS_TICKRATE: 60, // Physik-Berechnungen pro Sekunde
    SPATIAL_GRID_SIZE: 200
};

// SPIEL-ZUSTAND
const players = {};
let food = [];
let projectiles = [];
const projectilePool = [];

// Hilfsfunktionen
function getDistance(x1, y1, x2, y2) {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB', '#E67E22', '#2ECC71', '#F1C40F', '#E74C3C'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// SPATIAL HASHING
class SpatialHash {
    constructor(width, height, cellSize) {
        this.cellSize = cellSize;
        this.cols = Math.ceil(width / cellSize);
        this.rows = Math.ceil(height / cellSize);
        this.grid = new Array(this.cols * this.rows).fill(0).map(() => []);
    }

    clear() {
        for (let i = 0; i < this.grid.length; i++) {
            this.grid[i] = [];
        }
    }

    _getIndex(x, y) {
        const col = Math.floor(Math.max(0, Math.min(x, CONFIG.WORLD_WIDTH - 1)) / this.cellSize);
        const row = Math.floor(Math.max(0, Math.min(y, CONFIG.WORLD_HEIGHT - 1)) / this.cellSize);
        return col + row * this.cols;
    }

    insert(obj) {
        const index = this._getIndex(obj.x, obj.y);
        this.grid[index].push(obj);
    }

    getNearby(x, y, radius) {
        const results = [];
        const startCol = Math.floor(Math.max(0, x - radius) / this.cellSize);
        const endCol = Math.floor(Math.min(CONFIG.WORLD_WIDTH - 1, x + radius) / this.cellSize);
        const startRow = Math.floor(Math.max(0, y - radius) / this.cellSize);
        const endRow = Math.floor(Math.min(CONFIG.WORLD_HEIGHT - 1, y + radius) / this.cellSize);

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const index = c + r * this.cols;
                if (this.grid[index]) {
                    results.push(...this.grid[index]);
                }
            }
        }
        return results;
    }
}

const spatialHash = new SpatialHash(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT, CONFIG.SPATIAL_GRID_SIZE);

// FOOD SYSTEM
function spawnFood(count) {
    for (let i = 0; i < count; i++) {
        const radius = getRandomInt(3, 8);
        food.push({
            id: Math.random().toString(36).substr(2, 9),
            x: Math.random() * CONFIG.WORLD_WIDTH,
            y: Math.random() * CONFIG.WORLD_HEIGHT,
            radius: radius,
            value: Math.floor(radius * 2),
            color: getRandomColor(),
            shape: ['circle', 'square', 'triangle', 'pentagon'][getRandomInt(0, 3)]
        });
    }
}
spawnFood(CONFIG.FOOD_COUNT);

// PROJECTILE POOLING
function createProjectile(ownerId, x, y, angle, level, color) {
    let proj;
    if (projectilePool.length > 0) {
        proj = projectilePool.pop();
    } else {
        proj = {};
    }

    const radius = 5 + (level * 0.5);
    proj.id = Math.random().toString(36).substr(2, 9);
    proj.ownerId = ownerId;
    proj.x = x;
    proj.y = y;
    proj.vx = Math.cos(angle) * CONFIG.PROJECTILE_SPEED;
    proj.vy = Math.sin(angle) * CONFIG.PROJECTILE_SPEED;
    proj.radius = radius;
    proj.damage = CONFIG.PROJECTILE_DAMAGE_BASE + (level * 2);
    proj.lifespan = 120; // 2 Sekunden bei 60 FPS
    proj.color = color;

    return proj;
}

// LEVEL BERECHNUNG
function getLevel(score) {
    return Math.floor(Math.sqrt(score / 100)) + 1;
}

// SOCKET EVENTS
io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    socket.on('joinGame', (data) => {
        try {
            const name = (data.name || 'Anonym').substring(0, 15);
            const color = data.color || getRandomColor();

            players[socket.id] = {
                id: socket.id,
                x: Math.random() * CONFIG.WORLD_WIDTH,
                y: Math.random() * CONFIG.WORLD_HEIGHT,
                vx: 0,
                vy: 0,
                radius: CONFIG.PLAYER_START_RADIUS,
                mass: CONFIG.PLAYER_START_MASS,
                health: CONFIG.PLAYER_START_MASS,
                color: color,
                name: name,
                score: 0,
                kills: 0,
                killStreak: 0,
                level: 1,
                lastShot: 0,
                isDead: false,
                boostActive: false,
                joinTime: Date.now(),
                mouseX: 0,
                mouseY: 0
            };

            socket.emit('initGame', {
                yourId: socket.id,
                worldSize: { width: CONFIG.WORLD_WIDTH, height: CONFIG.WORLD_HEIGHT },
                players: Object.values(players),
                food: food
            });
        } catch (e) {
            console.error('Error during joinGame:', e);
        }
    });

    socket.on('mouseMove', (data) => {
        try {
            if (players[socket.id] && !players[socket.id].isDead && data && typeof data.x === 'number' && typeof data.y === 'number') {
                if (!isNaN(data.x) && !isNaN(data.y)) {
                    players[socket.id].mouseX = data.x;
                    players[socket.id].mouseY = data.y;
                }
            }
        } catch (e) {
            console.error('Error in mouseMove:', e);
        }
    });

    socket.on('shoot', (data) => {
        try {
            const player = players[socket.id];
            if (player && !player.isDead && data && typeof data.targetX === 'number' && typeof data.targetY === 'number') {
                if (isNaN(data.targetX) || isNaN(data.targetY)) return;

                const now = Date.now();
                if (now - player.lastShot > 300 && player.mass > 30) {
                    const angle = Math.atan2(data.targetY - player.y, data.targetX - player.x);

                    // Rückstoß
                    player.vx -= Math.cos(angle) * 8;
                    player.vy -= Math.sin(angle) * 8;

                    // Kosten
                    player.mass -= CONFIG.PROJECTILE_COST;
                    player.health = Math.min(player.health, player.mass);

                    const proj = createProjectile(socket.id, player.x, player.y, angle, player.level, player.color);
                    projectiles.push(proj);

                    player.lastShot = now;
                }
            }
        } catch (e) {
            console.error('Error in shoot:', e);
        }
    });

    socket.on('boost', (active) => {
        try {
            if (players[socket.id] && !players[socket.id].isDead) {
                players[socket.id].boostActive = !!active;
            }
        } catch (e) {
            console.error('Error in boost:', e);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        delete players[socket.id];
    });
});

// PHYSIK SIMULATION (60 FPS)
function updatePhysics() {
    const deltaTime = 1 / 60;

    // Spieler updaten
    for (const id in players) {
        const player = players[id];
        if (player.isDead) continue;

        // Boost Mechanik
        let speedMult = 1;
        if (player.boostActive && player.mass > 30) {
            speedMult = CONFIG.BOOST_MULTIPLIER;
            player.mass -= CONFIG.BOOST_COST_PER_SEC * deltaTime;
            player.health = Math.min(player.health, player.mass);
        }

        // Bewegung in Richtung Maus
        const targetAngle = Math.atan2(player.mouseY - player.y, player.mouseX - player.x);

        // Basis-Geschwindigkeit mit Massen-Abzug und Level-Malus (-5% pro Level)
        const levelPenalty = 1 - ((player.level - 1) * 0.05);
        const currentSpeed = (CONFIG.PLAYER_BASE_SPEED / (1 + player.mass / 500)) * Math.max(0.1, levelPenalty) * speedMult;

        const targetVx = Math.cos(targetAngle) * currentSpeed;
        const targetVy = Math.sin(targetAngle) * currentSpeed;

        // Beschleunigung (Lerp über ca. 0.2s)
        player.vx += (targetVx - player.vx) * 0.1;
        player.vy += (targetVy - player.vy) * 0.1;

        // Reibung
        player.vx *= 0.95;
        player.vy *= 0.95;

        // Position aktualisieren
        player.x += player.vx;
        player.y += player.vy;

        // Weltgrenzen einhalten
        player.x = Math.max(player.radius, Math.min(CONFIG.WORLD_WIDTH - player.radius, player.x));
        player.y = Math.max(player.radius, Math.min(CONFIG.WORLD_HEIGHT - player.radius, player.y));

        // Level-Update basierend auf Score
        player.level = getLevel(player.score);
        player.radius = CONFIG.PLAYER_START_RADIUS + (player.level * 3);

        // Minimale Masse sicherstellen
        if (player.mass < 10) player.mass = 10;
    }

    // Spatial Hash aktualisieren für Kollisionen
    spatialHash.clear();
    for (const id in players) {
        if (!players[id].isDead) spatialHash.insert(players[id]);
    }
    food.forEach(f => spatialHash.insert(f));

    // Kollisionen: Spieler vs Food
    for (const id in players) {
        const player = players[id];
        if (player.isDead) continue;

        const nearby = spatialHash.getNearby(player.x, player.y, player.radius + 20);
        for (const item of nearby) {
            if (item.value) { // Es ist Futter
                const dist = getDistance(player.x, player.y, item.x, item.y);
                if (dist < player.radius + item.radius) {
                    // Essen aufnehmen
                    player.mass += item.value;
                    player.score += item.value;
                    player.health = Math.min(player.health + item.value * 0.5, player.mass);

                    // Food entfernen
                    food = food.filter(f => f.id !== item.id);
                }
            }
        }
    }

    // Respawn Food
    if (food.length < 300) {
        spawnFood(10);
    }

    // Projektile updaten
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        proj.x += proj.vx;
        proj.y += proj.vy;
        proj.lifespan--;

        let destroyed = false;

        // Wand-Kollision
        if (proj.x < 0 || proj.x > CONFIG.WORLD_WIDTH || proj.y < 0 || proj.y > CONFIG.WORLD_HEIGHT || proj.lifespan <= 0) {
            destroyed = true;
        }

        // Spieler-Kollision (Spatial Hash nutzen)
        if (!destroyed) {
            const nearby = spatialHash.getNearby(proj.x, proj.y, proj.radius + 50);
            for (const other of nearby) {
                if (other.id && other.id !== proj.ownerId && !other.value) { // Es ist ein anderer Spieler
                    const dist = getDistance(proj.x, proj.y, other.x, other.y);
                    if (dist < other.radius + proj.radius) {
                        // Treffer!
                        other.health -= proj.damage;
                        other.mass -= proj.damage * 0.5;

                        const shooter = players[proj.ownerId];
                        if (shooter) {
                            shooter.score += Math.floor(proj.damage);
                        }

                        // Tod prüfen
                        if (other.health <= 0 && !other.isDead) {
                            other.isDead = true;
                            if (shooter) {
                                shooter.kills += 1;
                                shooter.killStreak += 1;
                                shooter.score += Math.floor(other.mass);
                            }
                            io.to(other.id).emit('playerDied', {
                                killerId: proj.ownerId,
                                killerName: shooter ? shooter.name : 'Unbekannt',
                                yourStats: {
                                    score: other.score,
                                    kills: other.kills,
                                    survivalTime: Math.floor((Date.now() - other.joinTime) / 1000)
                                }
                            });
                        }

                        destroyed = true;
                        break;
                    }
                }
            }
        }

        // Projektil-Kollision (vereinfacht: gegenseitige Zerstörung)
        if (!destroyed) {
            for (let j = 0; j < projectiles.length; j++) {
                const otherProj = projectiles[j];
                if (i !== j && proj.ownerId !== otherProj.ownerId) {
                    const dist = getDistance(proj.x, proj.y, otherProj.x, otherProj.y);
                    if (dist < proj.radius + otherProj.radius) {
                        destroyed = true;
                        projectiles.splice(j, 1);
                        projectilePool.push(otherProj);
                        if (j < i) i--; // Index anpassen
                        break;
                    }
                }
            }
        }

        if (destroyed) {
            projectiles.splice(i, 1);
            projectilePool.push(proj);
        }
    }
}

// GAME UPDATE (20 FPS)
function broadcastGameState() {
    const gameState = {
        players: Object.values(players).map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            radius: p.radius,
            mass: p.mass,
            health: p.health,
            color: p.color,
            name: p.name,
            score: p.score,
            kills: p.kills,
            killStreak: p.killStreak,
            level: p.level,
            isDead: p.isDead,
            boostActive: p.boostActive
        })),
        projectiles: projectiles.map(p => ({
            x: p.x,
            y: p.y,
            radius: p.radius,
            color: p.color
        })),
        food: food, // In einer echten Delta-Kompression würde man hier nur Änderungen senden
        timestamp: Date.now()
    };
    io.emit('gameUpdate', gameState);
}

// LEADERBOARD UPDATE (Alle 2 Sekunden)
setInterval(() => {
    const leaderboard = Object.values(players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => ({ name: p.name, score: p.score, kills: p.kills, id: p.id }));
    io.emit('leaderboardUpdate', leaderboard);
}, 2000);

// Server Loops starten
setInterval(updatePhysics, 1000 / CONFIG.PHYSICS_TICKRATE);
setInterval(broadcastGameState, 1000 / CONFIG.SERVER_TICKRATE);

server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('Server wird beendet...');
    server.close(() => {
        console.log('Server gestoppt.');
        process.exit(0);
    });
});
