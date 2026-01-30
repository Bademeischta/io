const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Konfiguration
const CONFIG = {
  WORLD_WIDTH: 3000,
  WORLD_HEIGHT: 3000,
  PLAYER_START_MASS: 100,
  PLAYER_START_RADIUS: 20,
  PLAYER_BASE_SPEED: 4,
  FOOD_COUNT: 400,
  FOOD_MIN_VALUE: 5,
  FOOD_MAX_VALUE: 20,
  PROJECTILE_SPEED: 12,
  PROJECTILE_DAMAGE: 15,
  PROJECTILE_COST: 5,
  BOOST_MULTIPLIER: 2.5,
  BOOST_COST_PER_SEC: 0.5,
  SERVER_TICKRATE: 20, // Netzwerk-Updates pro Sekunde
  PHYSICS_TICKRATE: 60, // Physik-Simulationen pro Sekunde
  GRID_SIZE: 200 // Für Spatial Hashing
};

// Spielzustand
const state = {
  players: {},
  food: [],
  projectiles: []
};

// Express Setup
app.use(express.static(path.join(__dirname, 'public')));

// Hilfsfunktionen
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function getRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F06292', '#AED581', '#FFD54F', '#4DB6AC', '#7986CB', '#9575CD', '#FF8A65'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Initialisiere Futter
function spawnFood(count = CONFIG.FOOD_COUNT) {
  for (let i = 0; i < count; i++) {
    state.food.push({
      id: generateId(),
      x: Math.random() * CONFIG.WORLD_WIDTH,
      y: Math.random() * CONFIG.WORLD_HEIGHT,
      radius: Math.random() * 5 + 3, // 3-8px
      value: 0, // Wird gleich berechnet
      color: getRandomColor(),
      shape: ['circle', 'square', 'triangle', 'pentagon'][Math.floor(Math.random() * 4)]
    });
    const lastFood = state.food[state.food.length - 1];
    lastFood.value = Math.floor(lastFood.radius * 2); // XP-Wert basierend auf Größe
  }
}

spawnFood();

// Spatial Hashing Grid
function createGrid() {
  const grid = new Map();
  const cols = Math.ceil(CONFIG.WORLD_WIDTH / CONFIG.GRID_SIZE);
  const rows = Math.ceil(CONFIG.WORLD_HEIGHT / CONFIG.GRID_SIZE);
  return { grid, cols, rows };
}

function getGridCell(x, y) {
  const gx = Math.floor(x / CONFIG.GRID_SIZE);
  const gy = Math.floor(y / CONFIG.GRID_SIZE);
  return `${gx},${gy}`;
}

function updateGrid() {
  const { grid } = spatialGrid;
  grid.clear();

  // Spieler in Grid einfügen
  for (const id in state.players) {
    const p = state.players[id];
    if (p.isDead) continue;
    const cell = getGridCell(p.x, p.y);
    if (!grid.has(cell)) grid.set(cell, { players: [], food: [], projectiles: [] });
    grid.get(cell).players.push(p);
  }

  // Futter in Grid einfügen
  for (const f of state.food) {
    const cell = getGridCell(f.x, f.y);
    if (!grid.has(cell)) grid.set(cell, { players: [], food: [], projectiles: [] });
    grid.get(cell).food.push(f);
  }

  // Projektile in Grid einfügen
  for (const pr of state.projectiles) {
    const cell = getGridCell(pr.x, pr.y);
    if (!grid.has(cell)) grid.set(cell, { players: [], food: [], projectiles: [] });
    grid.get(cell).projectiles.push(pr);
  }
}

const spatialGrid = createGrid();
let foodSpawnTimer = 0;

// Physik-Loop (60 FPS)
setInterval(() => {
  const deltaTime = 1 / CONFIG.PHYSICS_TICKRATE;
  updatePhysics(deltaTime);
}, 1000 / CONFIG.PHYSICS_TICKRATE);

function updatePhysics(dt) {
  // 1. Spieler-Bewegung
  for (const id in state.players) {
    const p = state.players[id];
    if (p.isDead) continue;

    // Boost Logik
    if (p.boostActive && p.mass > 30) {
      p.currentSpeed = CONFIG.PLAYER_BASE_SPEED * CONFIG.BOOST_MULTIPLIER / (1 + p.mass / 500);
      p.mass -= CONFIG.BOOST_COST_PER_SEC * dt;
      p.health = Math.min(p.health, p.mass);
    } else {
      p.currentSpeed = CONFIG.PLAYER_BASE_SPEED / (1 + p.mass / 500);
    }

    // Bewegung in Richtung Maus
    const dx = p.mouseX - p.x;
    const dy = p.mouseY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) {
      const targetVx = (dx / dist) * p.currentSpeed;
      const targetVy = (dy / dist) * p.currentSpeed;

      // Sanfte Beschleunigung (Lerp)
      p.vx += (targetVx - p.vx) * 0.1;
      p.vy += (targetVy - p.vy) * 0.1;
    } else {
      p.vx *= 0.95;
      p.vy *= 0.95;
    }

    p.x += p.vx;
    p.y += p.vy;

    // Map-Grenzen
    p.x = Math.max(p.radius, Math.min(CONFIG.WORLD_WIDTH - p.radius, p.x));
    p.y = Math.max(p.radius, Math.min(CONFIG.WORLD_HEIGHT - p.radius, p.y));

    // Level Update
    p.level = Math.floor(Math.sqrt(p.score / 100)) + 1;
    p.radius = CONFIG.PLAYER_START_RADIUS + (p.level * 3);
  }

  // 2. Projektil-Bewegung
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const pr = state.projectiles[i];
    pr.x += pr.vx;
    pr.y += pr.vy;
    pr.lifespan--;

    if (pr.lifespan <= 0 || pr.x < 0 || pr.x > CONFIG.WORLD_WIDTH || pr.y < 0 || pr.y > CONFIG.WORLD_HEIGHT) {
      state.projectiles.splice(i, 1);
    }
  }

  // 3. Kollisionsabfrage via Spatial Hashing
  updateGrid();
  checkCollisions();

  // 4. Futter Respawn
  foodSpawnTimer += dt;
  if (state.food.length < 300 && foodSpawnTimer >= 1.0) {
    spawnFood(10); // 10 pro Sekunde
    foodSpawnTimer = 0;
  }
}

function checkCollisions() {
  const { grid } = spatialGrid;

  for (const [cell, contents] of grid) {
    const [gx, gy] = cell.split(',').map(Number);
    const { players } = contents;

    // Wir prüfen diesen Cell und seine 8 Nachbarn für Kollisionen
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborCell = `${gx + dx},${gy + dy}`;
        const neighborContents = grid.get(neighborCell);
        if (!neighborContents) continue;

        // Spieler vs Futter
        for (const p of players) {
          for (let i = neighborContents.food.length - 1; i >= 0; i--) {
            const f = neighborContents.food[i];
            if (getDistance(p.x, p.y, f.x, f.y) < p.radius + f.radius) {
              p.mass += f.value;
              p.score += f.value;
              p.health = Math.min(p.health + f.value * 0.5, p.mass);

              const globalIdx = state.food.findIndex(foodItem => foodItem.id === f.id);
              if (globalIdx !== -1) state.food.splice(globalIdx, 1);
              neighborContents.food.splice(i, 1);
            }
          }
        }

        // Projektile vs Spieler
        for (let i = neighborContents.projectiles.length - 1; i >= 0; i--) {
          const pr = neighborContents.projectiles[i];
          for (const p of players) {
            if (pr.ownerId === p.id) continue;
            if (getDistance(pr.x, pr.y, p.x, p.y) < pr.radius + p.radius) {
              p.health -= pr.damage;
              p.mass -= pr.damage * 0.5;

              const shooter = state.players[pr.ownerId];
              if (shooter) {
                shooter.score += pr.damage;
                if (p.health <= 0 && !p.isDead) {
                  p.isDead = true;
                  p.lastKiller = shooter.name;
                  shooter.score += Math.max(0, p.mass);
                  shooter.kills += 1;
                  io.emit('playerDied', {
                    id: p.id,
                    killerName: shooter.name,
                    stats: { score: p.score, kills: p.kills }
                  });
                }
              }

              const globalPrIdx = state.projectiles.findIndex(item => item.id === pr.id);
              if (globalPrIdx !== -1) state.projectiles.splice(globalPrIdx, 1);
              neighborContents.projectiles.splice(i, 1);
              break;
            }
          }
        }

        // Projektile vs Projektile
        for (let i = neighborContents.projectiles.length - 1; i >= 0; i--) {
          const p1 = neighborContents.projectiles[i];
          // Um Doppelt-Checks zu vermeiden und nur Projektile in diesem Cell gegen Nachbarn zu prüfen
          // prüfen wir hier alle Projektile im neighborCell gegen alle Projektile in der aktuellen Cell (in contents)
          for (let j = contents.projectiles.length - 1; j >= 0; j--) {
            const p2 = contents.projectiles[j];
            if (p1.id === p2.id) continue;
            if (getDistance(p1.x, p1.y, p2.x, p2.y) < p1.radius + p2.radius) {
              const idx1 = state.projectiles.findIndex(item => item.id === p1.id);
              if (idx1 !== -1) state.projectiles.splice(idx1, 1);
              const idx2 = state.projectiles.findIndex(item => item.id === p2.id);
              if (idx2 !== -1) state.projectiles.splice(idx2, 1);

              neighborContents.projectiles.splice(i, 1);
              contents.projectiles.splice(j, 1);
              break;
            }
          }
        }
      }
    }
  }
}

function getDistance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Netzwerk-Loop (20 FPS)
setInterval(() => {
  const playersArray = Object.values(state.players).filter(p => !p.isDead).map(p => ({
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
    level: p.level,
    boostActive: p.boostActive
  }));

  io.emit('gameUpdate', {
    players: playersArray,
    projectiles: state.projectiles,
    food: state.food,
    timestamp: Date.now()
  });
}, 1000 / CONFIG.SERVER_TICKRATE);

// Leaderboard Update (alle 2 Sekunden)
setInterval(() => {
  const leaderboard = Object.values(state.players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ name: p.name, score: p.score, kills: p.kills }));

  io.emit('leaderboardUpdate', leaderboard);
}, 2000);

// Rate Limiting
const rateLimiter = new Map();
setInterval(() => rateLimiter.clear(), 1000);

io.on('connection', (socket) => {
  console.log(`Neuer Client verbunden: ${socket.id}`);

  socket.onAny(() => {
    const count = rateLimiter.get(socket.id) || 0;
    if (count > 100) {
      console.warn(`Kick ${socket.id}: Rate Limit überschritten`);
      socket.disconnect();
      return;
    }
    rateLimiter.set(socket.id, count + 1);
  });

  socket.on('joinGame', (data) => {
    const name = (data.name || 'Unbekannt').substring(0, 15);
    const color = data.color || getRandomColor();

    state.players[socket.id] = {
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
      level: 1,
      mouseX: 0,
      mouseY: 0,
      lastShot: 0,
      boostActive: false,
      isDead: false
    };

    socket.emit('initGame', {
      yourId: socket.id,
      worldSize: { width: CONFIG.WORLD_WIDTH, height: CONFIG.WORLD_HEIGHT },
      config: CONFIG
    });
  });

  socket.on('mouseMove', (data) => {
    const p = state.players[socket.id];
    if (p && !p.isDead) {
      // Validierung: Maus-Koordinaten sollten im vernünftigen Bereich sein (relativ zum Spieler + Viewport)
      // Aber wir nehmen sie erst mal an.
      p.mouseX = data.x;
      p.mouseY = data.y;
    }
  });

  socket.on('boost', (data) => {
    const p = state.players[socket.id];
    if (p && !p.isDead) {
      p.boostActive = !!data.active;
    }
  });

  socket.on('shoot', (data) => {
    const p = state.players[socket.id];
    if (p && !p.isDead) {
      const now = Date.now();
      if (now - p.lastShot > 300 && p.mass > 20) {
        p.lastShot = now;
        p.mass -= CONFIG.PROJECTILE_COST;
        p.health = Math.min(p.health, p.mass);

        const dx = data.targetX - p.x;
        const dy = data.targetY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          const vx = (dx / dist) * CONFIG.PROJECTILE_SPEED;
          const vy = (dy / dist) * CONFIG.PROJECTILE_SPEED;

          state.projectiles.push({
            id: generateId(),
            x: p.x + (dx / dist) * (p.radius + 10),
            y: p.y + (dy / dist) * (p.radius + 10),
            vx: vx,
            vy: vy,
            radius: 5 + (p.level * 0.5),
            damage: CONFIG.PROJECTILE_DAMAGE + (p.level * 2),
            ownerId: p.id,
            lifespan: 120, // 2 Sekunden bei 60 FPS
            color: p.color
          });

          // Rückstoß
          p.vx -= (dx / dist) * 8;
          p.vy -= (dy / dist) * 8;
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client getrennt: ${socket.id}`);
    delete state.players[socket.id];
  });
});

server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
