import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Vercel / Cloudflare
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// File Path Helpers
// ============================================================================
function getCandidatePath(candidates) {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

const PLAYERS_DIR = getCandidatePath([
  process.env.DATABASE_PLAYERS_DIR,
  '/root/downloads/Project-D/Core/x64/Release/database/players',
  '/root/downloads/Project-D/database/players',
  path.join(__dirname, '..', 'downloads', 'Project-D', 'Core', 'x64', 'Release', 'database', 'players'),
  path.join(__dirname, 'data', 'players'),
]);

const EDIT_ITEM_PATH = getCandidatePath([
  process.env.EDIT_ITEM_PATH,
  '/root/downloads/Project-D/Core/x64/Release/database/json/edit_itemv2.json',
  '/root/downloads/Project-D/database/json/edit_itemv2.json',
  path.join(__dirname, '..', 'downloads', 'Project-D', 'Core', 'x64', 'Release', 'database', 'json', 'edit_itemv2.json'),
  path.join(__dirname, 'data', 'edit_itemv2.json'),
]);

const ITEMS_DICT_PATH = getCandidatePath([
  process.env.ITEMS_DICT_PATH,
  '/root/downloads/Project-D/Core/x64/Release/database/items_dict.json',
  '/root/downloads/Project-D/database/items_dict.json',
  path.join(__dirname, '..', 'downloads', 'Project-D', 'Core', 'x64', 'Release', 'database', 'items_dict.json'),
  path.join(__dirname, 'data', 'items_dict.json'),
]);

const AUDIT_LOG_PATH = path.join(__dirname, 'data', 'staff_audit_logs.json');

const PROJECT_D_ADMIN_API = process.env.PROJECT_D_ADMIN_API || 'http://127.0.0.1:8888';
const PROJECT_D_ADMIN_TOKEN = process.env.PROJECT_D_ADMIN_TOKEN || '4080b44cb0ae479d654c6fdaec4e914498e396a37835956f';
const REMOTE_GAME_SERVER = process.env.REMOTE_GAME_SERVER || 'http://secretxz.duckdns.org';

// ============================================================================
// In-Memory Caches & Sessions
// ============================================================================
let itemsDict = {}; // raw dict: { [id]: { name, rarity, action } }
let editItemMap = new Map(); // Map<id, edit_item_object>
let editItemsList = [];
let staffSessions = new Map(); // token -> { growId, role, roleLevel, expiresAt }
let auditLogs = [];

// Popular Punch Effects
export const PUNCH_EFFECTS = [
  { id: 0, name: 'Default / None' },
  { id: 2, name: 'Fire / Flame Punch' },
  { id: 5, name: 'Electro Spark Punch' },
  { id: 20, name: 'Frost / Ice Punch' },
  { id: 29, name: 'Shadow Ghost Strike' },
  { id: 36, name: 'Emerald Sparkle' },
  { id: 80, name: "Rayman's Fist (Mythical)" },
  { id: 111, name: 'Golden Thunder Strike' },
  { id: 137, name: 'Cosmic Star Shower' },
  { id: 218, name: 'Gryffindor Sword Slash' },
  { id: 237, name: 'Void Chaos Explosion' },
  { id: 500, name: 'Super Galaxy Burst' },
];

// Load items dictionary
function loadItemsDict() {
  try {
    if (fs.existsSync(ITEMS_DICT_PATH)) {
      const raw = fs.readFileSync(ITEMS_DICT_PATH, 'utf-8');
      itemsDict = JSON.parse(raw);
      console.log(`[ITEM EDITOR] Loaded ${Object.keys(itemsDict).length} items from items_dict.json`);
    } else {
      console.warn(`[ITEM EDITOR] items_dict.json not found at ${ITEMS_DICT_PATH}`);
    }
  } catch (err) {
    console.error('[ITEM EDITOR] Error parsing items_dict.json:', err.message);
  }
}

// Load edit_itemv2.json
function loadEditItemv2() {
  try {
    if (fs.existsSync(EDIT_ITEM_PATH)) {
      const raw = fs.readFileSync(EDIT_ITEM_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      editItemsList = parsed.items || [];
      editItemMap.clear();
      for (const it of editItemsList) {
        if (it && it.ID !== undefined) {
          editItemMap.set(Number(it.ID), it);
        }
      }
      console.log(`[ITEM EDITOR] Loaded ${editItemMap.size} custom overrides from edit_itemv2.json`);
    } else {
      console.warn(`[ITEM EDITOR] edit_itemv2.json not found at ${EDIT_ITEM_PATH}`);
    }
  } catch (err) {
    console.error('[ITEM EDITOR] Error loading edit_itemv2.json:', err.message);
  }
}

// Save edit_itemv2.json atomically
function saveEditItemv2() {
  try {
    const list = Array.from(editItemMap.values());
    const payload = { items: list };
    const jsonStr = JSON.stringify(payload, null, 4);

    const dir = path.dirname(EDIT_ITEM_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${EDIT_ITEM_PATH}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
    fs.renameSync(tmpPath, EDIT_ITEM_PATH);

    // Also mirror to bundled data directory if different
    const localDataPath = path.join(__dirname, 'data', 'edit_itemv2.json');
    if (path.resolve(EDIT_ITEM_PATH) !== path.resolve(localDataPath)) {
      try {
        fs.writeFileSync(localDataPath, jsonStr, 'utf-8');
      } catch {}
    }

    editItemsList = list;
    return true;
  } catch (err) {
    console.error('[ITEM EDITOR] Failed to save edit_itemv2.json:', err);
    return false;
  }
}

// Load audit logs
function loadAuditLogs() {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      auditLogs = JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf-8')) || [];
    }
  } catch {}
}

function addAuditLog(growId, role, action, details) {
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    growId,
    role,
    action,
    details,
    timestamp: Date.now(),
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > 500) auditLogs.pop();
  try {
    const dir = path.dirname(AUDIT_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(auditLogs, null, 2), 'utf-8');
  } catch {}
}

// Notify Project-D C++ Server via HTTP
async function notifyCppServer(endpoint, payload) {
  return new Promise((resolve) => {
    try {
      const url = new URL(endpoint, PROJECT_D_ADMIN_API);
      const data = JSON.stringify(payload);
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'X-Admin-Token': PROJECT_D_ADMIN_TOKEN,
          },
          timeout: 2000,
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body });
          });
        }
      );
      req.on('error', () => resolve({ ok: false, error: 'Cannot connect to C++ port 8888' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Timeout' });
      });
      req.write(data);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// Initial load
loadItemsDict();
loadEditItemv2();
loadAuditLogs();

// ============================================================================
// Staff Authentication & Role Verification
// ============================================================================
function readPlayerData(growId) {
  if (!growId) return null;
  const clean = growId.trim();
  const direct = path.join(PLAYERS_DIR, `${clean}_.json`);
  if (fs.existsSync(direct)) {
    try {
      return JSON.parse(fs.readFileSync(direct, 'utf-8'));
    } catch {}
  }
  const want = `${clean.toLowerCase()}_.json`;
  try {
    if (fs.existsSync(PLAYERS_DIR)) {
      const files = fs.readdirSync(PLAYERS_DIR);
      for (const f of files) {
        if (f.toLowerCase() === want) {
          return JSON.parse(fs.readFileSync(path.join(PLAYERS_DIR, f), 'utf-8'));
        }
      }
    }
  } catch {}
  return null;
}

export function checkStaffRole(data) {
  if (!data) return { isStaff: false, roleName: 'Player', roleLevel: 0 };

  const customRole = String(data['Role.custom_role_name'] || '').trim();

  if (data['Role.Owner_Server'] || data.role === 'Owner') {
    return { isStaff: true, roleName: customRole || 'Owner', roleLevel: 555, badge: '👑 OWNER' };
  }
  if (data['Role.Developer'] || data.role === 'Developer') {
    return { isStaff: true, roleName: customRole || 'Developer', roleLevel: 444, badge: '⚙️ DEVELOPER' };
  }
  if (data['Role.Administrator'] || data.role === 'Administrator' || data.role === 'Admin') {
    return { isStaff: true, roleName: customRole || 'Administrator', roleLevel: 333, badge: '🛡️ ADMIN' };
  }
  if (data['Role.Coder']) {
    return { isStaff: true, roleName: customRole || 'Coder', roleLevel: 300, badge: '💻 CODER' };
  }
  if (data['Role.Moderator'] || data.role === 'Moderator') {
    return { isStaff: true, roleName: customRole || 'Moderator', roleLevel: 222, badge: '⭐ MODERATOR' };
  }
  if (data['Role.Staff']) {
    return { isStaff: true, roleName: customRole || 'Staff', roleLevel: 200, badge: '🎖️ STAFF' };
  }
  if (data['Role.has_config_access']) {
    return { isStaff: true, roleName: customRole || 'Config Admin', roleLevel: 200, badge: '🔑 CONFIG' };
  }

  return { isStaff: false, roleName: 'Player', roleLevel: 0, badge: 'PLAYER' };
}

// Middleware: Require Staff Token
function requireStaffAuth(req, res, next) {
  let token = req.headers['authorization'];
  if (token && token.startsWith('Bearer ')) {
    token = token.substring(7);
  }
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Sesi login tidak ditemukan. Silakan login kembali.' });
  }

  const session = staffSessions.get(token);
  if (!session) {
    return res.status(401).json({ status: 'error', message: 'Sesi tidak valid atau telah kedaluwarsa.' });
  }

  if (Date.now() > session.expiresAt) {
    staffSessions.delete(token);
    return res.status(401).json({ status: 'error', message: 'Sesi login telah habis. Silakan login ulang.' });
  }

  req.staff = session;
  next();
}

// ============================================================================
// Item Classification & Data Mapping
// ============================================================================
function categorizeItem(action) {
  const act = Number(action);
  if (act === 20) return 'clothes'; // Wearables / Clothes
  if (act === 17 || act === 18 || act === 14 || act === 15 || act === 21 || act === 22 || act === 12 || act === 37 || act === 26 || act === 2) {
    return 'block'; // Solid block, wallpaper, platform, hazard, portal, etc.
  }
  if (act === 19) return 'seed';
  if (act === 8) return 'item';
  return 'other';
}

function formatItemObject(id, dictEntry, editEntry) {
  const itemId = Number(id);
  const baseName = dictEntry ? dictEntry.name : `Item #${itemId}`;
  const baseRarity = dictEntry ? Number(dictEntry.rarity) || 0 : 0;
  const action = dictEntry ? Number(dictEntry.action) || 0 : 0;
  const category = categorizeItem(action);

  if (!editEntry) {
    return {
      id: itemId,
      name: baseName,
      baseName,
      desc: '',
      rarity: baseRarity,
      action,
      category,
      isEdited: false,
      isGacha: false,
      farPunch: 0,
      punchPlace: 0,
      punchHit: 0,
      gems: 0,
      xp: 0,
      punchId: 0,
      bonus: 0,
      itemPrice: 0,
      changeDropSeeds: 0,
      blockChance: 0,
      extraDrops: [],
      extraChance: [],
      extraDropsMode: 0,
      property_farmable: false,
      property_untradeable: false,
      property_blacklist: false,
      property_blocked: false,
      property_unobtainable: false,
    };
  }

  return {
    id: itemId,
    name: editEntry.Name || baseName,
    baseName,
    desc: editEntry.Desc || '',
    rarity: editEntry.rarity !== undefined ? Number(editEntry.rarity) : baseRarity,
    action,
    category,
    isEdited: true,
    isGacha: Boolean(editEntry.property_gacha),
    farPunch: Number(editEntry.Far_Punch) || 0,
    punchPlace: Number(editEntry.Punch_Place) || 0,
    punchHit: Number(editEntry.Punch_Hit) || 0,
    gems: Number(editEntry.Gems) || 0,
    xp: Number(editEntry.Xp) || 0,
    punchId: Number(editEntry.Punch_Id) || 0,
    bonus: Number(editEntry.Bonus) || 0,
    itemPrice: Number(editEntry.Item_Price) || 0,
    changeDropSeeds: Number(editEntry.Change_Drop_Seeds) || 0,
    blockChance: Number(editEntry.Block_Chance) || 0,
    extraDrops: Array.isArray(editEntry.Extra_Drops) ? editEntry.Extra_Drops : [],
    extraChance: Array.isArray(editEntry.Extra_Chance) ? editEntry.Extra_Chance : [],
    extraDropsMode: Number(editEntry.ExtraDropsMode) || 0,
    property_farmable: Boolean(editEntry.property_farmable),
    property_untradeable: Boolean(editEntry.property_untradeable),
    property_blacklist: Boolean(editEntry.property_blacklist),
    property_blocked: Boolean(editEntry.property_blocked),
    property_unobtainable: Boolean(editEntry.property_unobtainable),
  };
}

// ============================================================================
// API ROUTES
// ============================================================================

// 1. Staff Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { growId, password } = req.body;
    if (!growId || !password) {
      return res.status(400).json({ status: 'error', message: 'GrowID dan Password harus diisi.' });
    }

    const cleanId = growId.trim();
    let playerData = readPlayerData(cleanId);

    // If not found locally, attempt remote auth bridge
    if (!playerData && REMOTE_GAME_SERVER) {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 4000);
        const remoteRes = await fetch(`${REMOTE_GAME_SERVER}/api/player/auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Token': PROJECT_D_ADMIN_TOKEN,
          },
          body: JSON.stringify({ growId: cleanId, password }),
          signal: ctrl.signal,
        });
        clearTimeout(timeout);
        if (remoteRes.ok) {
          const rData = await remoteRes.json();
          if (rData && rData.status === 'ok') {
            playerData = rData.player || { tankIDName: cleanId, pass: password, 'Role.Staff': true };
          }
        }
      } catch {}
    }

    if (!playerData) {
      return res.status(404).json({
        status: 'error',
        message: `Akun GrowID "${cleanId}" tidak ditemukan di database server Project-D.`,
      });
    }

    // Verify Password
    const storedPass = String(playerData.pass || '');
    if (storedPass !== password) {
      return res.status(401).json({
        status: 'error',
        message: 'Password salah! Periksa kembali password akun Growtopia Anda.',
      });
    }

    // Check Staff Role
    const roleInfo = checkStaffRole(playerData);
    if (!roleInfo.isStaff) {
      return res.status(403).json({
        status: 'error',
        message: 'Akses Ditolak: Hanya akun dengan role Staff, Moderator, Admin, atau Developer yang dapat mengakses Web Editor ini.',
      });
    }

    // Issue Token
    const token = crypto.randomBytes(32).toString('hex');
    const realGrowId = playerData.tankIDName || cleanId;
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    staffSessions.set(token, {
      growId: realGrowId,
      roleName: roleInfo.roleName,
      roleLevel: roleInfo.roleLevel,
      badge: roleInfo.badge,
      expiresAt,
    });

    addAuditLog(realGrowId, roleInfo.roleName, 'STAFF_LOGIN', 'Berhasil login ke Web Admin Editor');

    return res.json({
      status: 'ok',
      message: `Selamat datang, ${realGrowId}!`,
      token,
      staff: {
        growId: realGrowId,
        roleName: roleInfo.roleName,
        roleLevel: roleInfo.roleLevel,
        badge: roleInfo.badge,
      },
    });
  } catch (err) {
    console.error('[AUTH ERROR]:', err);
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan internal pada server auth.' });
  }
});

// 2. Staff Me / Verify Session
app.get('/api/auth/me', requireStaffAuth, (req, res) => {
  return res.json({
    status: 'ok',
    staff: {
      growId: req.staff.growId,
      roleName: req.staff.roleName,
      roleLevel: req.staff.roleLevel,
      badge: req.staff.badge,
    },
  });
});

// 3. Staff Logout
app.post('/api/auth/logout', requireStaffAuth, (req, res) => {
  let token = req.headers['authorization'];
  if (token && token.startsWith('Bearer ')) token = token.substring(7);
  if (token) staffSessions.delete(token);
  return res.json({ status: 'ok', message: 'Logout berhasil.' });
});

// 4. Punch Effects List
app.get('/api/items/punch-effects', requireStaffAuth, (_req, res) => {
  return res.json({ status: 'ok', effects: PUNCH_EFFECTS });
});

// 5. Item Search & Filtering
app.get('/api/items', requireStaffAuth, (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const category = String(req.query.category || 'all').toLowerCase(); // all | clothes | block | gacha | edited
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 30));

    let results = [];

    // Filter items
    const parsedId = /^\d+$/.test(search) ? parseInt(search) : null;

    if (category === 'edited' || category === 'gacha') {
      // Iterate directly over editItemMap for fast filtering
      for (const [id, editEntry] of editItemMap.entries()) {
        if (category === 'gacha' && !editEntry.property_gacha) continue;

        const dictEntry = itemsDict[id];
        const formatted = formatItemObject(id, dictEntry, editEntry);

        if (search) {
          const matchId = parsedId !== null && id === parsedId;
          const matchName = formatted.name.toLowerCase().includes(search) || formatted.baseName.toLowerCase().includes(search);
          if (!matchId && !matchName) continue;
        }

        results.push(formatted);
      }
    } else {
      // Iterate through itemsDict
      const allIds = Object.keys(itemsDict);
      for (let i = 0; i < allIds.length; i++) {
        const id = Number(allIds[i]);
        const dictEntry = itemsDict[id];
        const editEntry = editItemMap.get(id);

        const act = dictEntry ? dictEntry.action : 0;
        const itemCat = categorizeItem(act);

        if (category === 'clothes' && itemCat !== 'clothes') continue;
        if (category === 'block' && itemCat !== 'block') continue;

        if (search) {
          const matchId = parsedId !== null && id === parsedId;
          const matchName = dictEntry && (dictEntry.name.toLowerCase().includes(search) || (editEntry && editEntry.Name && editEntry.Name.toLowerCase().includes(search)));
          if (!matchId && !matchName) continue;
        }

        results.push(formatItemObject(id, dictEntry, editEntry));
      }
    }

    // Sort: Edited / Gacha items first, then by ID
    results.sort((a, b) => {
      if (a.isEdited && !b.isEdited) return -1;
      if (!a.isEdited && b.isEdited) return 1;
      return a.id - b.id;
    });

    const total = results.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const curPage = Math.min(page, totalPages);
    const start = (curPage - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return res.json({
      status: 'ok',
      items: paginated,
      total,
      page: curPage,
      totalPages,
      limit,
    });
  } catch (err) {
    console.error('[ITEM SEARCH ERROR]:', err);
    return res.status(500).json({ status: 'error', message: 'Gagal memproses pencarian item.' });
  }
});

// 6. Get Item Details
app.get('/api/items/:id', requireStaffAuth, (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id) || id < 0) {
    return res.status(400).json({ status: 'error', message: 'Item ID tidak valid.' });
  }

  const dictEntry = itemsDict[id];
  const editEntry = editItemMap.get(id);

  if (!dictEntry && !editEntry) {
    return res.status(404).json({ status: 'error', message: `Item ID #${id} tidak ditemukan.` });
  }

  const formatted = formatItemObject(id, dictEntry, editEntry);
  return res.json({ status: 'ok', item: formatted });
});

// 7. Save Item Changes (Clothes / Block / Gacha)
app.post('/api/items/save', requireStaffAuth, async (req, res) => {
  try {
    const b = req.body;
    const id = Number(b.id);
    if (isNaN(id) || id < 0) {
      return res.status(400).json({ status: 'error', message: 'Item ID tidak valid.' });
    }

    const dictEntry = itemsDict[id];
    const baseName = dictEntry ? dictEntry.name : `Item #${id}`;

    // Prepare Edit_ItemV2 object
    const updated = {
      ID: id,
      Name: b.name ? String(b.name).trim() : baseName,
      Desc: b.desc !== undefined ? String(b.desc).trim() : 'This item has been modified by Staff.',
      rarity: b.rarity !== undefined ? Math.max(0, parseInt(b.rarity) || 0) : (dictEntry ? dictEntry.rarity : 0),
      Break_Hits: Math.max(0, parseInt(b.punchHit || b.Break_Hits) || 0),
      Far_Punch: Math.max(0, Math.min(25, parseInt(b.farPunch || b.Far_Punch) || 0)),
      Punch_Place: Math.max(0, Math.min(25, parseInt(b.punchPlace || b.Punch_Place) || 0)),
      Punch_Hit: Math.max(0, Math.min(25, parseInt(b.punchHit || b.Punch_Hit) || 0)),
      Punch_Id: Math.max(0, parseInt(b.punchId || b.Punch_Id) || 0),
      Gems: Math.max(0, parseInt(b.gems || b.Gems) || 0),
      Xp: Math.max(0, parseInt(b.xp || b.Xp) || 0),
      Bonus: Math.max(0, parseInt(b.bonus || b.Bonus) || 0),
      Item_Price: Math.max(0, parseInt(b.itemPrice || b.Item_Price) || 0),
      Change_Drop_Seeds: Math.max(0, Math.min(100, parseInt(b.changeDropSeeds || b.Change_Drop_Seeds) || 0)),
      Block_Chance: parseInt(b.blockChance || b.Block_Chance) || 0,
      ExtraDropsMode: b.extraDropsMode ? 1 : 0,
      Extra_Drops: Array.isArray(b.extraDrops) ? b.extraDrops.map((d) => [Number(d[0]), Number(d[1])]) : [],
      Extra_Chance: Array.isArray(b.extraChance) ? b.extraChance.map((c) => Number(c)) : [],
      property_gacha: Boolean(b.property_gacha || b.isGacha),
      property_farmable: Boolean(b.property_farmable),
      property_untradeable: Boolean(b.property_untradeable),
      property_blacklist: Boolean(b.property_blacklist),
      property_blocked: Boolean(b.property_blocked),
      property_unobtainable: Boolean(b.property_unobtainable),
    };

    // Ensure Extra_Chance matches Extra_Drops length
    while (updated.Extra_Chance.length < updated.Extra_Drops.length) {
      updated.Extra_Chance.push(10);
    }
    if (updated.Extra_Chance.length > updated.Extra_Drops.length) {
      updated.Extra_Chance = updated.Extra_Chance.slice(0, updated.Extra_Drops.length);
    }

    // Save into in-memory map
    editItemMap.set(id, updated);

    // Save to disk atomically
    const saved = saveEditItemv2();
    if (!saved) {
      return res.status(500).json({ status: 'error', message: 'Gagal menulis data ke database edit_itemv2.json.' });
    }

    // Notify Project-D C++ server for instant live in-game reload
    let serverSync = false;
    try {
      const cppPayload = {
        id,
        name: updated.Name,
        description: updated.Desc,
        rarity: updated.rarity,
        breakHits: updated.Punch_Hit,
        max_gems: updated.Gems,
        xp: updated.Xp,
        farmable: updated.property_farmable,
        untradeable: updated.property_untradeable,
        blocked_place: updated.property_blocked,
        newdropchance: updated.Change_Drop_Seeds,
      };
      const syncRes = await notifyCppServer('/api/admin/items/save', cppPayload);
      serverSync = syncRes.ok;
    } catch {}

    // Audit log
    const staffName = req.staff.growId;
    const staffRole = req.staff.roleName;
    const actionDesc = updated.property_gacha
      ? `Set Block #${id} (${updated.Name}) menjadi GACHA dengan ${updated.Extra_Drops.length} hadiah drop`
      : `Update item #${id} (${updated.Name}) [FarPunch: ${updated.Far_Punch}, FarPut: ${updated.Punch_Place}, Hit: ${updated.Punch_Hit}, xGems: ${updated.Gems}, xXP: ${updated.Xp}]`;

    addAuditLog(staffName, staffRole, 'SAVE_ITEM', actionDesc);

    return res.json({
      status: 'ok',
      message: `Item #${id} (${updated.Name}) berhasil disimpan & aktif live!`,
      item: formatItemObject(id, dictEntry, updated),
      serverSync,
    });
  } catch (err) {
    console.error('[SAVE ITEM ERROR]:', err);
    return res.status(500).json({ status: 'error', message: `Gagal menyimpan item: ${err.message}` });
  }
});

// 8. Reset Item to Default
app.post('/api/items/reset', requireStaffAuth, async (req, res) => {
  try {
    const id = Number(req.body.id);
    if (isNaN(id) || id < 0) {
      return res.status(400).json({ status: 'error', message: 'Item ID tidak valid.' });
    }

    if (!editItemMap.has(id)) {
      return res.status(404).json({ status: 'error', message: `Item #${id} belum memiliki custom override.` });
    }

    editItemMap.delete(id);
    saveEditItemv2();

    // Notify Project-D C++ server
    try {
      await notifyCppServer('/api/admin/items/reset', { id });
    } catch {}

    const dictEntry = itemsDict[id];
    const itemName = dictEntry ? dictEntry.name : `Item #${id}`;

    addAuditLog(req.staff.growId, req.staff.roleName, 'RESET_ITEM', `Reset item #${id} (${itemName}) ke setelan bawaan`);

    return res.json({
      status: 'ok',
      message: `Item #${id} (${itemName}) berhasil di-reset ke pengaturan bawaan server!`,
      item: formatItemObject(id, dictEntry, null),
    });
  } catch (err) {
    console.error('[RESET ITEM ERROR]:', err);
    return res.status(500).json({ status: 'error', message: 'Gagal mereset item.' });
  }
});

// 9. Dashboard Statistics
app.get('/api/stats', requireStaffAuth, (_req, res) => {
  let gachaCount = 0;
  let clothesWithFarReach = 0;
  let clothesWithXGems = 0;
  let clothesWithXXp = 0;

  for (const it of editItemMap.values()) {
    if (it.property_gacha) gachaCount++;
    if ((it.Far_Punch || 0) > 0 || (it.Punch_Place || 0) > 0) clothesWithFarReach++;
    if ((it.Gems || 0) > 0) clothesWithXGems++;
    if ((it.Xp || 0) > 0) clothesWithXXp++;
  }

  return res.json({
    status: 'ok',
    stats: {
      totalDictItems: Object.keys(itemsDict).length || 31074,
      totalCustomItems: editItemMap.size,
      totalGachaBlocks: gachaCount,
      clothesWithFarReach,
      clothesWithXGems,
      clothesWithXXp,
      activeStaffSessions: staffSessions.size,
      recentAuditLogs: auditLogs.slice(0, 8),
    },
  });
});

// Fallback to index.html for SPA client-side routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// Server Listener
// ============================================================================
app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`  Project-D Web Admin Panel (Item & Clothes/Block Editor)`);
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Items Dictionary : ${ITEMS_DICT_PATH}`);
  console.log(`  EditItem Database: ${EDIT_ITEM_PATH}`);
  console.log(`  Players Database : ${PLAYERS_DIR}`);
  console.log('================================================================');
});
