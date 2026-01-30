const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- KONFIGURATION ---
const CONFIG = {
    WORLD_WIDTH: 3000,
    WORLD_HEIGHT: 3000,
    GRID_SIZE: 200,
    PLAYER_START_MASS: 100,
    PLAYER_START_RADIUS: 20,
    PLAYER_BASE_SPEED: 4,
    LEVEL_XP_RATIO: 100,
    PROJECTILE_SPEED: 12,
    PROJECTILE_DAMAGE: 15,
    PROJECTILE_COST: 5,
    SHOOT_COOLDOWN: 300,
    BOOST_MULTIPLIER: 2.5,
    BOOST_COST_PER_SEC: 0.5,
    BOOST_MIN_MASS: 30,
    FOOD_COUNT: 400,
    FOOD_MIN_RESPAWN: 300,
    MAX_POWERUPS: 5,
    POWERUP_CHANCE: 0.01,
    BOT_COUNT: 12,
    BOT_TRAINING_INTERVAL: 30000,
    BOT_MEMORY_SIZE: 10000,
    BOT_BATCH_SIZE: 32,
    SERVER_TICKRATE: 20,
    PHYSICS_TICKRATE: 60,
    AUTO_SAVE_INTERVAL: 5 * 60 * 1000,
};

// --- SPIELZUSTAND ---
const state = {
    players: {},
    food: [],
    projectiles: [],
    bots: [],
    blockedIPs: new Map(),
};

// --- DATEI-SYSTEM ---
const DIRS = ['data/bots', 'data/backups', 'data/logs'];
DIRS.forEach(dir => {
    if (!fs.existsSync(path.join(__dirname, dir))) {
        fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
    }
});

// --- HILFSFUNKTIONEN ---
function generateId() { return Math.random().toString(36).substring(2, 15); }
function getRandomColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F06292', '#AED581', '#FFD54F', '#4DB6AC', '#7986CB', '#9575CD', '#FF8A65'];
    return colors[Math.floor(Math.random() * colors.length)];
}
function getDistance(x1, y1, x2, y2) { return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2); }

function log(type, message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    console.log(logMsg.trim());
    fs.appendFileSync(path.join(__dirname, 'data/logs/server.log'), logMsg);
    if (level === 'cheat') fs.appendFileSync(path.join(__dirname, 'data/logs/anti-cheat.log'), logMsg);
}

// --- KI-SYSTEM: NEURONALES NETZWERK ---
class NeuralNetwork {
    constructor(inputSize, hiddenSize, outputSize) {
        this.inputSize = inputSize; this.hiddenSize = hiddenSize; this.outputSize = outputSize;
        this.w1 = this.createMatrix(inputSize, hiddenSize);
        this.b1 = new Array(hiddenSize).fill(0);
        this.w2 = this.createMatrix(hiddenSize, hiddenSize);
        this.b2 = new Array(hiddenSize).fill(0);
        this.w3 = this.createMatrix(hiddenSize, outputSize);
        this.b3 = new Array(outputSize).fill(0);
        this.learningRate = 0.001;
    }
    createMatrix(rows, cols) {
        const matrix = new Array(rows);
        for (let i = 0; i < rows; i++) {
            matrix[i] = new Array(cols);
            for (let j = 0; j < cols; j++) matrix[i][j] = (Math.random() * 2 - 1) * Math.sqrt(1 / rows);
        }
        return matrix;
    }
    relu(x) { return Math.max(0, x); }
    reluDeriv(x) { return x > 0 ? 1 : 0; }
    sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
    tanh(x) { return Math.tanh(x); }

    forward(input) {
        this.h1 = new Array(this.hiddenSize).fill(0);
        for (let j = 0; j < this.hiddenSize; j++) {
            let sum = this.b1[j];
            for (let i = 0; i < this.inputSize; i++) sum += input[i] * this.w1[i][j];
            this.h1[j] = this.relu(sum);
        }
        this.h2 = new Array(this.hiddenSize).fill(0);
        for (let j = 0; j < this.hiddenSize; j++) {
            let sum = this.b2[j];
            for (let i = 0; i < this.hiddenSize; i++) sum += this.h1[i] * this.w2[i][j];
            this.h2[j] = this.relu(sum);
        }
        const output = new Array(this.outputSize).fill(0);
        for (let j = 0; j < this.outputSize; j++) {
            let sum = this.b3[j];
            for (let i = 0; i < this.hiddenSize; i++) sum += this.h2[i] * this.w3[i][j];
            if (j === 0 || j === 1) output[j] = this.tanh(sum);
            else if (j === 3) output[j] = this.sigmoid(sum) * 360;
            else output[j] = this.sigmoid(sum);
        }
        return output;
    }

    train(input, targetOutput) {
        const output = this.forward(input);
        const outputErrors = output.map((val, i) => targetOutput[i] - val);
        for (let j = 0; j < this.outputSize; j++) {
            const error = outputErrors[j];
            this.b3[j] += error * this.learningRate;
            for (let i = 0; i < this.hiddenSize; i++) this.w3[i][j] += error * this.h2[i] * this.learningRate;
        }
        const h2Errors = new Array(this.hiddenSize).fill(0);
        for (let i = 0; i < this.hiddenSize; i++) {
            let error = 0;
            for (let j = 0; j < this.outputSize; j++) error += outputErrors[j] * this.w3[i][j];
            h2Errors[i] = error * this.reluDeriv(this.h2[i]);
        }
        for (let j = 0; j < this.hiddenSize; j++) {
            this.b2[j] += h2Errors[j] * this.learningRate;
            for (let i = 0; i < this.hiddenSize; i++) this.w2[i][j] += h2Errors[j] * this.h1[i] * this.learningRate;
        }
        const h1Errors = new Array(this.hiddenSize).fill(0);
        for (let i = 0; i < this.hiddenSize; i++) {
            let error = 0;
            for (let j = 0; j < this.hiddenSize; j++) error += h2Errors[j] * this.w2[i][j];
            h1Errors[i] = error * this.reluDeriv(this.h1[i]);
        }
        for (let j = 0; j < this.hiddenSize; j++) {
            this.b1[j] += h1Errors[j] * this.learningRate;
            for (let i = 0; i < this.inputSize; i++) this.w1[i][j] += h1Errors[j] * input[i] * this.learningRate;
        }
    }

    getWeights() { return { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2, w3: this.w3, b3: this.b3 }; }
    setWeights(weights) { this.w1 = weights.w1; this.b1 = weights.b1; this.w2 = weights.w2; this.b2 = weights.b2; this.w3 = weights.w3; this.b3 = weights.b3; }
}

// --- KI-SYSTEM: BOT KLASSE ---
class Bot {
    constructor(id, name, personality) {
        this.id = id; this.name = name; this.personality = personality;
        this.color = this.getColorByPersonality(personality);
        this.brain = new NeuralNetwork(30, 64, 6);
        this.memory = []; this.epsilon = 0.8; this.gamma = 0.95;
        this.stats = { totalGames: 0, totalKills: 0, totalDeaths: 0, bestScore: 0, trainingEpoch: 0 };
        this.lastState = null; this.lastAction = null;
        this.trainingOffset = Math.floor(Math.random() * 30000);
        this.lastPos = { x: 0, y: 0 }; this.inactiveTime = 0;
        this.playerData = {
            id, name, color: this.color, x: Math.random() * CONFIG.WORLD_WIDTH, y: Math.random() * CONFIG.WORLD_HEIGHT,
            vx: 0, vy: 0, radius: CONFIG.PLAYER_START_RADIUS, mass: CONFIG.PLAYER_START_MASS, health: CONFIG.PLAYER_START_MASS,
            score: 0, kills: 0, level: 1, boostActive: false, isDead: false, isBot: true, mouseX: 0, mouseY: 0, lastShot: 0
        };
    }
    getColorByPersonality(p) {
        if (p === 'hunter') return '#ff0000';
        if (p === 'farmer') return '#00ff00';
        if (p === 'tactician') return '#0000ff';
        return '#ff00ff';
    }
    getInputs(state) {
        const p = this.playerData;
        const inputs = new Array(30).fill(0);
        inputs[0] = p.x / CONFIG.WORLD_WIDTH; inputs[1] = p.y / CONFIG.WORLD_HEIGHT;
        inputs[2] = p.vx / 10; inputs[3] = p.vy / 10;
        inputs[4] = p.mass / 1000; inputs[5] = p.health / p.mass; inputs[6] = p.level / 20;
        const otherPlayers = Object.values(state.players).filter(op => op.id !== this.id && !op.isDead)
            .sort((a, b) => getDistance(p.x, p.y, a.x, a.y) - getDistance(p.x, p.y, b.x, b.y)).slice(0, 5);
        for (let i = 0; i < 5; i++) {
            if (otherPlayers[i]) {
                const op = otherPlayers[i];
                inputs[7 + i * 4] = Math.atan2(op.y - p.y, op.x - p.x) / Math.PI;
                inputs[8 + i * 4] = getDistance(p.x, p.y, op.x, op.y) / (CONFIG.WORLD_WIDTH * 1.4);
                inputs[9 + i * 4] = (op.level - p.level) / 10;
                inputs[10 + i * 4] = op.health / op.mass;
            }
        }
        inputs[27] = Math.min(p.x, p.y, CONFIG.WORLD_WIDTH - p.x, CONFIG.WORLD_HEIGHT - p.y) / 500;
        inputs[28] = Object.values(state.players).filter(op => op.id !== this.id && !op.isDead && getDistance(p.x, p.y, op.x, op.y) < 200).length / 10;
        inputs[29] = state.food.filter(f => getDistance(p.x, p.y, f.x, f.y) < 100).length / 20;
        return inputs;
    }
    think(state) {
        if (this.playerData.isDead) return;
        const inputs = this.getInputs(state);
        let actions = (Math.random() < this.epsilon) ? [Math.random()*2-1, Math.random()*2-1, Math.random(), Math.random()*360, Math.random(), Math.random()] : this.brain.forward(inputs);
        this.lastState = inputs; this.lastAction = actions;
        this.playerData.mouseX = this.playerData.x + actions[0] * 100;
        this.playerData.mouseY = this.playerData.y + actions[1] * 100;
        this.playerData.boostActive = actions[4] > 0.8;
        if (actions[2] > 0.7) { this.shouldShoot = true; this.shootAngle = actions[3]; }
    }
    getReward(state, event) {
        let reward = 0.167; const p = this.playerData;
        if (event === 'food') reward += 10;
        if (event === 'hit') reward += 50;
        if (event === 'kill') reward += 200;
        if (event === 'death') reward -= 200;
        if (event === 'miss') reward -= 5;
        if (event === 'wall') reward -= 30;
        const distMoved = getDistance(p.x, p.y, this.lastPos.x, this.lastPos.y);
        if (distMoved < 1) { this.inactiveTime++; if (this.inactiveTime > 180) reward -= 5; } else this.inactiveTime = 0;
        if (p.boostActive) {
            if (!Object.values(state.players).some(op => op.id !== this.id && !op.isDead && getDistance(p.x, p.y, op.x, op.y) < 400) && p.health / p.mass > 0.7) reward -= 10;
        }
        if (p.health / p.mass < 0.3) {
            const nearestEnemy = Object.values(state.players).filter(op => op.id !== this.id && !op.isDead).sort((a, b) => getDistance(p.x, p.y, a.x, a.y) - getDistance(p.x, p.y, b.x, b.y))[0];
            if (nearestEnemy && getDistance(p.x, p.y, nearestEnemy.x, nearestEnemy.y) > getDistance(this.lastPos.x, this.lastPos.y, nearestEnemy.x, nearestEnemy.y)) reward += 20;
        }
        this.lastPos = { x: p.x, y: p.y };
        if (this.personality === 'hunter') { if (event === 'kill') reward *= 1.5; if (event === 'food') reward *= 0.5; }
        else if (this.personality === 'farmer') { if (event === 'food') reward *= 2.0; if (event === 'death') reward *= 2.0; }
        return reward;
    }
    learn(reward, nextState) {
        if (!this.lastState) return;
        const priority = Math.abs(reward) + 0.01;
        this.memory.push({ state: this.lastState, action: this.lastAction, reward, nextState, done: this.playerData.isDead, priority });
        if (this.memory.length > CONFIG.BOT_MEMORY_SIZE) this.memory.shift();
    }
    trainBatch() {
        if (this.memory.length < CONFIG.BOT_BATCH_SIZE) return;
        const batch = []; const totalPriority = this.memory.reduce((sum, exp) => sum + exp.priority, 0);
        for (let i = 0; i < CONFIG.BOT_BATCH_SIZE; i++) {
            let pick = Math.random() * totalPriority, currentSum = 0;
            for (const exp of this.memory) { currentSum += exp.priority; if (currentSum >= pick) { batch.push(exp); break; } }
            if (batch.length <= i) batch.push(this.memory[this.memory.length - 1]);
        }
        batch.forEach(exp => {
            const currentQ = this.brain.forward(exp.state); let targetQ = [...currentQ];
            const nextQ = this.brain.forward(exp.nextState); const maxNextQ = Math.max(...nextQ);
            for (let i = 0; i < 6; i++) targetQ[i] = exp.done ? exp.reward : exp.reward + this.gamma * maxNextQ;
            this.brain.train(exp.state, targetQ);
        });
        this.epsilon = Math.max(0.1, this.epsilon * 0.9995); this.stats.trainingEpoch++;
    }
    save() {
        const data = { name: this.name, personality: this.personality, color: this.color, weights: this.brain.getWeights(), epsilon: this.epsilon, stats: this.stats };
        fs.writeFileSync(path.join(__dirname, `data/bots/bot_${this.name.toLowerCase()}.json`), JSON.stringify(data));
    }
    load() {
        const filePath = path.join(__dirname, `data/bots/bot_${this.name.toLowerCase()}.json`);
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath));
            this.brain.setWeights(data.weights); this.epsilon = data.epsilon; this.stats = data.stats; return true;
        }
        return false;
    }
}

// --- KI-SYSTEM: BOT MANAGER ---
const BotManager = {
    init() {
        const personalities = ['hunter', 'farmer', 'tactician', 'wildcard'];
        for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
            const name = `Bot_${i + 1}`, personality = personalities[i % 4], bot = new Bot(generateId(), name, personality);
            if (!bot.load()) { log('bot', `Neuer Bot: ${name} (${personality})`); bot.save(); }
            else log('bot', `Bot geladen: ${name} (${personality})`);
            state.bots.push(bot); state.players[bot.id] = bot.playerData;
        }
        state.bots.forEach(bot => { setTimeout(() => { setInterval(() => bot.trainBatch(), CONFIG.BOT_TRAINING_INTERVAL); }, bot.trainingOffset); });
        setInterval(() => { state.bots.forEach(bot => bot.save()); log('system', 'Bots gespeichert'); }, CONFIG.AUTO_SAVE_INTERVAL);
        setInterval(() => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
            const backupDir = path.join(__dirname, `data/backups/${timestamp}`); fs.mkdirSync(backupDir, { recursive: true });
            state.bots.forEach(bot => {
                const data = { name: bot.name, personality: bot.personality, color: bot.color, weights: bot.brain.getWeights(), epsilon: bot.epsilon, stats: bot.stats };
                fs.writeFileSync(path.join(backupDir, `bot_${bot.name.toLowerCase()}.json`), JSON.stringify(data));
            });
            const backups = fs.readdirSync(path.join(__dirname, 'data/backups')), now = Date.now();
            backups.forEach(b => { const bPath = path.join(__dirname, 'data/backups', b); if (now - fs.statSync(bPath).mtimeMs > 7 * 24 * 60 * 60 * 1000) fs.rmSync(bPath, { recursive: true, force: true }); });
        }, 60 * 60 * 1000);
    }
};

// --- PHYSIK & SPIEL-LOGIK ---
const SpatialGrid = {
    grid: new Map(),
    update() {
        this.grid.clear();
        Object.values(state.players).forEach(p => { if (!p.isDead) { const cell = this.getCell(p.x, p.y); if (!this.grid.has(cell)) this.grid.set(cell, { players: [], food: [], projectiles: [] }); this.grid.get(cell).players.push(p); } });
        state.food.forEach(f => { const cell = this.getCell(f.x, f.y); if (!this.grid.has(cell)) this.grid.set(cell, { players: [], food: [], projectiles: [] }); this.grid.get(cell).food.push(f); });
        state.projectiles.forEach(pr => { const cell = this.getCell(pr.x, pr.y); if (!this.grid.has(cell)) this.grid.set(cell, { players: [], food: [], projectiles: [] }); this.grid.get(cell).projectiles.push(pr); });
    },
    getCell(x, y) { return `${Math.floor(x / CONFIG.GRID_SIZE)},${Math.floor(y / CONFIG.GRID_SIZE)}`; }
};

function spawnFood(count = CONFIG.FOOD_COUNT) {
    let currentPowerUps = state.food.filter(f => f.isPowerUp).length;
    for (let i = 0; i < count; i++) {
        const f = { id: generateId(), x: Math.random() * CONFIG.WORLD_WIDTH, y: Math.random() * CONFIG.WORLD_HEIGHT, radius: Math.random() * 5 + 3, color: getRandomColor(), shape: ['circle', 'square', 'triangle', 'pentagon'][Math.floor(Math.random() * 4)], isPowerUp: false };
        f.value = Math.floor(f.radius * 2);
        if (currentPowerUps < CONFIG.MAX_POWERUPS && Math.random() < CONFIG.POWERUP_CHANCE) { f.isPowerUp = true; f.radius = 12; f.color = '#FFD700'; f.powerUpType = ['shield', 'damage', 'speed'][Math.floor(Math.random() * 3)]; currentPowerUps++; }
        state.food.push(f);
    }
}

function updatePhysics(dt) {
    state.bots.forEach(bot => {
        const streak = bot.playerData.killStreak || 0, reactionDelay = Math.min(10, Math.floor(streak / 5));
        if (!bot.frameCounter) bot.frameCounter = 0;
        bot.frameCounter++;
        if (bot.frameCounter > reactionDelay) {
            bot.frameCounter = 0; bot.think(state);
            if (bot.shouldShoot) { handleShoot(bot.playerData, bot.shootAngle); bot.shouldShoot = false; }
        }
        bot.learn(bot.getReward(state), bot.getInputs(state));
    });
    Object.values(state.players).forEach(p => {
        if (p.isDead) return;
        const oldX = p.x, oldY = p.y;
        if (p.powerUps) Object.keys(p.powerUps).forEach(type => { if (Date.now() > p.powerUps[type]) delete p.powerUps[type]; });
        let speedMult = (p.powerUps && p.powerUps.speed) ? 1.5 : 1.0;
        if (p.boostActive && p.mass > CONFIG.BOOST_MIN_MASS) { p.currentSpeed = (CONFIG.PLAYER_BASE_SPEED * CONFIG.BOOST_MULTIPLIER * speedMult) / (1 + p.mass / 500); p.mass -= CONFIG.BOOST_COST_PER_SEC * dt; p.health = Math.min(p.health, p.mass); }
        else { p.currentSpeed = (CONFIG.PLAYER_BASE_SPEED * speedMult) / (1 + p.mass / 500); p.boostActive = false; }
        const dx = p.mouseX - p.x, dy = p.mouseY - p.y, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) { p.vx += ((dx / dist) * p.currentSpeed - p.vx) * 0.1; p.vy += ((dy / dist) * p.currentSpeed - p.vy) * 0.1; } else { p.vx *= 0.95; p.vy *= 0.95; }
        p.x += p.vx; p.y += p.vy;
        if (p.x < p.radius || p.x > CONFIG.WORLD_WIDTH - p.radius || p.y < p.radius || p.y > CONFIG.WORLD_HEIGHT - p.radius) { if (p.isBot) { const bot = state.bots.find(b => b.id === p.id); if (bot) bot.learn(bot.getReward(state, 'wall'), bot.getInputs(state)); } }
        p.x = Math.max(p.radius, Math.min(CONFIG.WORLD_WIDTH - p.radius, p.x)); p.y = Math.max(p.radius, Math.min(CONFIG.WORLD_HEIGHT - p.radius, p.y));
        if (!p.isBot) { const actualDist = getDistance(p.x, p.y, oldX, oldY), maxDist = p.currentSpeed * dt * 60 * 1.5; if (actualDist > maxDist) { p.warningCount = (p.warningCount || 0) + 1; p.x = oldX; p.y = oldY; p.vx = 0; p.vy = 0; log('cheat', `Speed: ${p.name}`, 'cheat'); if (p.warningCount >= 10) { const s = io.sockets.sockets.get(p.id); if (s) s.disconnect(true); } } }
        p.level = Math.floor(Math.sqrt(p.score / CONFIG.LEVEL_XP_RATIO)) + 1; p.radius = CONFIG.PLAYER_START_RADIUS + (p.level * 3);
    });
    for (let i = state.projectiles.length - 1; i >= 0; i--) { const pr = state.projectiles[i]; pr.x += pr.vx; pr.y += pr.vy; pr.lifespan--; if (pr.lifespan <= 0 || pr.x < 0 || pr.x > CONFIG.WORLD_WIDTH || pr.y < 0 || pr.y > CONFIG.WORLD_HEIGHT) { const s = state.players[pr.ownerId]; if (s && s.isBot) { const bot = state.bots.find(b => b.id === s.id); if (bot) bot.learn(bot.getReward(state, 'miss'), bot.getInputs(state)); } state.projectiles.splice(i, 1); } }
    SpatialGrid.update(); checkCollisions(); if (state.food.length < CONFIG.FOOD_MIN_RESPAWN) spawnFood(10);
}

function checkCollisions() {
    const projectilesToDelete = new Set(), { grid } = SpatialGrid;
    for (const [cell, contents] of grid) {
        const [gx, gy] = cell.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const neighborContents = grid.get(`${gx + dx},${gy + dy}`); if (!neighborContents) continue;
                contents.players.forEach(p => {
                    for (let i = neighborContents.food.length - 1; i >= 0; i--) {
                        const f = neighborContents.food[i]; if (getDistance(p.x, p.y, f.x, f.y) < p.radius + f.radius) {
                            if (f.isPowerUp) { if (!p.powerUps) p.powerUps = {}; p.powerUps[f.powerUpType] = Date.now() + (f.powerUpType === 'shield' ? 5000 : (f.powerUpType === 'damage' ? 8000 : 6000)); sendSystemMessage('powerup', { name: p.name, type: f.powerUpType }); }
                            else { p.mass += f.value; p.score += f.value; p.health = Math.min(p.health + f.value * 0.5, p.mass); if (p.isBot) { const bot = state.bots.find(b => b.id === p.id); if (bot) bot.learn(bot.getReward(state, 'food'), bot.getInputs(state)); } }
                            const gIdx = state.food.findIndex(item => item.id === f.id); if (gIdx !== -1) state.food.splice(gIdx, 1); neighborContents.food.splice(i, 1);
                        }
                    }
                });
                neighborContents.projectiles.forEach(pr => {
                    if (projectilesToDelete.has(pr.id)) return;
                    contents.players.forEach(p => {
                        if (pr.ownerId === p.id || p.isDead) return;
                        if (getDistance(pr.x, pr.y, p.x, p.y) < pr.radius + p.radius) {
                            if (p.powerUps && p.powerUps.shield) { projectilesToDelete.add(pr.id); return; }
                            p.health -= pr.damage; p.mass -= pr.damage * 0.5; const s = state.players[pr.ownerId];
                            if (s) { s.score += pr.damage; if (s.isBot) { const bot = state.bots.find(b => b.id === s.id); if (bot) bot.learn(bot.getReward(state, 'hit'), bot.getInputs(state)); } if (p.health <= 0) handlePlayerDeath(p, s); }
                            projectilesToDelete.add(pr.id);
                        }
                    });
                });
                neighborContents.projectiles.forEach(p1 => { if (projectilesToDelete.has(p1.id)) return; contents.projectiles.forEach(p2 => { if (p1.id !== p2.id && !projectilesToDelete.has(p2.id) && getDistance(p1.x, p1.y, p2.x, p2.y) < p1.radius + p2.radius) { projectilesToDelete.add(p1.id); projectilesToDelete.add(p2.id); } }); });
            }
        }
    }
    state.projectiles = state.projectiles.filter(pr => !projectilesToDelete.has(pr.id));
}

function handleShoot(p, angle) {
    const now = Date.now(); if (now - p.lastShot < CONFIG.SHOOT_COOLDOWN || p.mass < 20) return;
    if (!p.isBot && now - p.lastShot < CONFIG.SHOOT_COOLDOWN * 0.8) { log('cheat', `Shotrate: ${p.name}`, 'cheat'); return; }
    p.lastShot = now; p.mass -= CONFIG.PROJECTILE_COST; p.health = Math.min(p.health, p.mass);
    const rad = (angle * Math.PI) / 180, vx = Math.cos(rad) * CONFIG.PROJECTILE_SPEED, vy = Math.sin(rad) * CONFIG.PROJECTILE_SPEED;
    state.projectiles.push({ id: generateId(), x: p.x + Math.cos(rad) * (p.radius + 10), y: p.y + Math.sin(rad) * (p.radius + 10), vx, vy, radius: 5 + (p.level * 0.5), damage: (CONFIG.PROJECTILE_DAMAGE + (p.level * 2)) * ((p.powerUps && p.powerUps.damage) ? 2 : 1), ownerId: p.id, color: p.color, lifespan: 120 });
    p.vx -= Math.cos(rad) * 8; p.vy -= Math.sin(rad) * 8;
}

function handlePlayerDeath(victim, killer) {
    if (victim.isDead) return; victim.isDead = true; victim.lastKiller = killer.name; killer.kills += 1; killer.score += Math.max(100, victim.mass * 0.5);
    killer.killStreak = (killer.killStreak || 0) + 1; if (killer.killStreak >= 3) { killer.onFire = true; sendSystemMessage('streak', { name: killer.name, count: killer.killStreak }); }
    victim.killStreak = 0; victim.onFire = false;
    if (victim.isBot) { const bot = state.bots.find(b => b.id === victim.id); if (bot) { bot.stats.totalDeaths++; bot.learn(bot.getReward(state, 'death'), bot.getInputs(state)); bot.save(); } setTimeout(() => { victim.isDead = false; victim.x = Math.random() * CONFIG.WORLD_WIDTH; victim.y = Math.random() * CONFIG.WORLD_HEIGHT; victim.mass = CONFIG.PLAYER_START_MASS; victim.health = CONFIG.PLAYER_START_MASS; victim.score = 0; victim.level = 1; }, 3000); }
    if (killer.isBot) { const bot = state.bots.find(b => b.id === killer.id); if (bot) { bot.stats.totalKills++; bot.learn(bot.getReward(state, 'kill'), bot.getInputs(state)); } }
    io.emit('playerDied', { id: victim.id, killerName: killer.name, stats: { score: victim.score, kills: victim.kills } }); sendSystemMessage('death', { victim: victim.name, killer: killer.name });
}

function sendSystemMessage(type, data) {
    let t = '', c = '#888';
    if (type === 'join') t = `🟢 ${data.name} ist beigetreten`; else if (type === 'leave') t = `🔴 ${data.name} hat verlassen`; else if (type === 'death') { t = `💀 ${data.victim} wurde von ${data.killer} eliminiert`; c = '#e74c3c'; }
    else if (type === 'streak') { t = `🔥 ${data.name} ist ON FIRE! (${data.count} Kills)`; c = '#ff6600'; } else if (type === 'powerup') { t = `⚡ ${data.name} hat ${data.type.toUpperCase()} erhalten!`; c = '#f1c40f'; }
    io.emit('systemMessage', { text: t, color: c });
}

io.on('connection', (socket) => {
    const ip = socket.handshake.address; if (state.blockedIPs.has(ip) && state.blockedIPs.get(ip) > Date.now()) { socket.emit('error', 'Gesperrt'); socket.disconnect(); return; }
    const rate = { count: 0, last: Date.now() };
    socket.onAny(() => { const now = Date.now(); if (now - rate.last > 1000) { rate.count = 0; rate.last = now; } if (++rate.count > 200) { state.blockedIPs.set(ip, now + 300000); socket.disconnect(); } });
    socket.on('joinGame', (d) => { try { const n = (d.name || 'Unbekannt').substring(0, 15).replace(/[<>]/g, ''); state.players[socket.id] = { id: socket.id, name: n, color: d.color || getRandomColor(), x: Math.random() * CONFIG.WORLD_WIDTH, y: Math.random() * CONFIG.WORLD_HEIGHT, vx: 0, vy: 0, radius: CONFIG.PLAYER_START_RADIUS, mass: CONFIG.PLAYER_START_MASS, health: CONFIG.PLAYER_START_MASS, score: 0, kills: 0, level: 1, mouseX: 0, mouseY: 0, lastShot: 0, boostActive: false, isDead: false, isBot: false }; socket.emit('initGame', { yourId: socket.id, worldSize: { width: CONFIG.WORLD_WIDTH, height: CONFIG.WORLD_HEIGHT }, config: CONFIG }); sendSystemMessage('join', { name: n }); } catch (e) {} });
    socket.on('mouseMove', (d) => { const p = state.players[socket.id]; if (p && !p.isDead) { p.mouseX = Math.max(-5000, Math.min(CONFIG.WORLD_WIDTH + 5000, d.x)); p.mouseY = Math.max(-5000, Math.min(CONFIG.WORLD_HEIGHT + 5000, d.y)); } });
    socket.on('boost', (d) => { const p = state.players[socket.id]; if (p && !p.isDead) p.boostActive = !!d.active; });
    socket.on('shoot', (d) => { const p = state.players[socket.id]; if (p && !p.isDead) handleShoot(p, Math.atan2(d.targetY - p.y, d.targetX - p.x) * 180 / Math.PI); });
    socket.on('chat', (m) => { const p = state.players[socket.id]; if (p && !p.isDead && typeof m === 'string') { const s = m.substring(0, 50).replace(/[<>]/g, ''); if (s.trim()) io.emit('chat', { name: p.name, color: p.color, message: s }); } });
    socket.on('debugSpawnBot', () => { const b = new Bot(generateId(), `DebugBot_${Math.floor(Math.random()*100)}`, 'wildcard'); state.bots.push(b); state.players[b.id] = b.playerData; });
    socket.on('disconnect', () => { const p = state.players[socket.id]; if (p) { sendSystemMessage('leave', { name: p.name }); delete state.players[socket.id]; } });
});

setInterval(() => updatePhysics(1 / CONFIG.PHYSICS_TICKRATE), 1000 / CONFIG.PHYSICS_TICKRATE);
setInterval(() => { const pArr = Object.values(state.players).filter(p => !p.isDead).map(p => ({ id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, radius: p.radius, mass: p.mass, health: p.health, color: p.color, name: p.name, score: p.score, kills: p.kills, level: p.level, boostActive: p.boostActive, onFire: p.onFire, powerUps: p.powerUps ? Object.keys(p.powerUps) : [] })); io.emit('gameUpdate', { players: pArr, projectiles: state.projectiles, food: state.food, timestamp: Date.now() }); }, 1000 / CONFIG.SERVER_TICKRATE);
setInterval(() => { const lb = Object.values(state.players).sort((a, b) => b.score - a.score).slice(0, 10).map(p => ({ name: p.name, score: p.score, kills: p.kills, isBot: p.isBot })); io.emit('leaderboardUpdate', lb); }, 2000);

spawnFood(); BotManager.init();
process.on('SIGINT', () => { log('system', 'Shutdown...'); io.emit('systemMessage', { text: '⚠️ Neustart...', color: '#ff0000' }); state.bots.forEach(b => b.save()); setTimeout(() => process.exit(0), 1000); });
process.on('uncaughtException', (e) => { log('error', e.message); state.bots.forEach(b => b.save()); });
app.use(express.static(path.join(__dirname, 'public')));
server.listen(PORT, () => log('system', `Port ${PORT}`));
