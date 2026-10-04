import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
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

  // Forward to remote VPS so logs are never lost on Vercel serverless
  const isVercel = Boolean(process.env.VERCEL) || !fs.existsSync('/root/downloads/Project-D');
  if (isVercel && REMOTE_GAME_SERVER) {
    try {
      doHttpRequest(`${REMOTE_GAME_SERVER}/api/audit-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': PROJECT_D_ADMIN_TOKEN,
        },
        body: entry,
        timeout: 3000,
      }).catch(() => {});
    } catch {}
  }
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

// Universal HTTP/HTTPS Request Helper (compatible across Node 12 to 22)
function doHttpRequest(targetUrl, options = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(targetUrl);
      const isHttps = u.protocol === 'https:';
      const lib = isHttps ? https : http;
      const data = options.body
        ? typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
        : null;

      const reqOptions = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: options.method || 'GET',
        headers: {
          ...(options.headers || {}),
        },
        timeout: options.timeout || 6000,
      };

      if (data) {
        reqOptions.headers['Content-Type'] = reqOptions.headers['Content-Type'] || 'application/json';
        reqOptions.headers['Content-Length'] = Buffer.byteLength(data);
      }

      const req = lib.request(reqOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {}
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body,
            data: parsed,
          });
        });
      });

      req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: 'Request timeout' });
      });

      if (data) req.write(data);
      req.end();
    } catch (err) {
      resolve({ ok: false, status: 0, error: err.message });
    }
  });
}

// Remote Sync Item to VPS Game Server
async function syncRemoteItem(action, payload) {
  const url = `${REMOTE_GAME_SERVER}/api/items/sync`;
  console.log(`[REMOTE SYNC] Sending ${action} to ${url}...`);
  const res = await doHttpRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': PROJECT_D_ADMIN_TOKEN,
    },
    body: { action, ...payload },
    timeout: 6000,
  });
  return res;
}

// Auto-refresh items cache from VPS when running on Vercel
let lastRemoteSyncTime = 0;
async function refreshRemoteEditItemsIfNeeded() {
  const isVercel = Boolean(process.env.VERCEL) || !fs.existsSync('/root/downloads/Project-D');
  if (!isVercel) return;
  if (Date.now() - lastRemoteSyncTime < 8000) return; // cache for 8 seconds
  try {
    const url = `${REMOTE_GAME_SERVER}/api/items/sync`;
    const res = await doHttpRequest(url, { method: 'GET', timeout: 4000 });
    if (res.ok && res.data && Array.isArray(res.data.items)) {
      editItemMap.clear();
      for (const item of res.data.items) {
        if (item && item.ID !== undefined) {
          editItemMap.set(Number(item.ID), item);
        }
      }
      editItemsList = res.data.items;
      lastRemoteSyncTime = Date.now();
    }
  } catch {}
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

export function isClistUser(growId) {
  if (!growId) return false;
  const want = String(growId).toLowerCase();
  const knownClist = ['secretxz', 'tirtaivn', 'bintangalvarendra', 'secretxzz', 'xiruni'];
  if (knownClist.includes(want)) return true;

  try {
    const configPath = path.join(PROJECT_D_RELEASE_DIR, 'database', 'json', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const clist = (cfg && cfg.GAME && cfg.GAME.CREATOR_LIST) ? cfg.GAME.CREATOR_LIST : [];
      return clist.some((x) => String(x).toLowerCase() === want);
    }
  } catch {}
  return false;
}

export function checkStaffRole(data) {
  if (!data) return { isStaff: false, isConfig: false, roleName: 'Player', roleLevel: 0, badge: 'PLAYER' };

  if (data._remoteRoleInfo) {
    return {
      isStaff: Boolean(data._remoteRoleInfo.isStaff),
      isConfig: Boolean(data._remoteRoleInfo.isConfig),
      roleName: data._remoteRoleInfo.roleName || 'Player',
      roleLevel: Number(data._remoteRoleInfo.roleLevel) || 0,
      badge: data._remoteRoleInfo.badge || 'PLAYER',
    };
  }

  const customRole = String(data['Role.custom_role_name'] || '').trim();
  const growId = String(data.tankIDName || data.name || '').trim();

  // Check custom roles from custom_roles.json
  let customRoleLevel = 0;
  if (customRole) {
    try {
      const crPath = path.join(PROJECT_D_RELEASE_DIR, 'database', 'json', 'custom_roles.json');
      if (fs.existsSync(crPath)) {
        const roles = JSON.parse(fs.readFileSync(crPath, 'utf-8'));
        const found = roles.find((r) => String(r.name).toLowerCase() === customRole.toLowerCase());
        if (found) {
          customRoleLevel = Number(found.level || 0);
        }
      }
    } catch {}
  }

  // Exact Project-D C++ Hierarchy (WorldInfo.h / Commands.h):
  // 999: Config Access (Role.has_config_access) -> ONLY Role with isConfig: true
  // 13: Creator List (CREATOR_LIST / Role.Clist)
  // 12: Coder (Role.Coder)
  // 11: Owner (Role.Owner_Server)
  // 10: Staff (Role.Staff)
  // --- Below 10 (Restricted from web admin login): ---
  // 9: Streamers | 8: Unlimited | 7: God | 6: Donatur | 5: Developer | 4: Administrator | 3: Moderator | 2: VIP | 1: Cheater | 0: Player

  if (Boolean(data['Role.has_config_access'])) {
    return { isStaff: true, isConfig: true, roleName: customRole || 'Config Access', roleLevel: 999, badge: '🔑 CONFIG' };
  }
  if (isClistUser(growId) || Boolean(data['Role.Clist'])) {
    return { isStaff: true, isConfig: false, roleName: customRole || 'Creator', roleLevel: 13, badge: '⚡ CREATOR' };
  }
  if (customRoleLevel >= 10) {
    return {
      isStaff: true,
      isConfig: customRoleLevel >= 999,
      roleName: customRole,
      roleLevel: customRoleLevel,
      badge: customRoleLevel >= 999 ? '🔑 CONFIG' : `🔰 ${customRole.toUpperCase()}`,
    };
  }
  if (Boolean(data['Role.Coder'])) {
    return { isStaff: true, isConfig: false, roleName: customRole || 'Coder', roleLevel: 12, badge: '💻 CODER' };
  }
  if (Boolean(data['Role.Owner_Server']) || data.role === 'Owner') {
    return { isStaff: true, isConfig: false, roleName: customRole || 'Owner', roleLevel: 11, badge: '👑 OWNER' };
  }
  if (Boolean(data['Role.Staff']) || data.role === 'Staff') {
    return { isStaff: true, isConfig: false, roleName: customRole || 'Staff', roleLevel: 10, badge: '🎖️ STAFF' };
  }

  // Detailed level check for restricted roles (< 10)
  let restrictedLevel = 0;
  let restrictedRole = 'Player';
  if (data['Role.Streamers']) { restrictedLevel = 9; restrictedRole = 'Streamers'; }
  else if (data['Role.Unlimited']) { restrictedLevel = 8; restrictedRole = 'Unlimited'; }
  else if (data['Role.God']) { restrictedLevel = 7; restrictedRole = 'God'; }
  else if (data['Role.Donatur']) { restrictedLevel = 6; restrictedRole = 'Donatur'; }
  else if (data['Role.Developer'] || data.role === 'Developer') { restrictedLevel = 5; restrictedRole = 'Developer'; }
  else if (data['Role.Administrator'] || data.role === 'Administrator' || data.role === 'Admin') { restrictedLevel = 4; restrictedRole = 'Administrator'; }
  else if (data['Role.Moderator'] || data.role === 'Moderator') { restrictedLevel = 3; restrictedRole = 'Moderator'; }
  else if (data['Role.Vip']) { restrictedLevel = 2; restrictedRole = 'VIP'; }
  else if (data['Role.Cheats']) { restrictedLevel = 1; restrictedRole = 'Cheater'; }

  return {
    isStaff: false,
    isConfig: false,
    roleName: customRole || restrictedRole,
    roleLevel: customRoleLevel || restrictedLevel,
    badge: (customRole || restrictedRole).toUpperCase(),
  };
}

const JWT_SECRET = process.env.JWT_SECRET || PROJECT_D_ADMIN_TOKEN || 'project-d-staff-secret-key-super-secure';

function toBase64Url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function createStaffToken(payload) {
  const data = JSON.stringify({
    ...payload,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  const encoded = toBase64Url(data);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(encoded).digest('hex');
  return `${encoded}.${sig}`;
}

function verifyStaffToken(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(encoded).digest('hex');
  if (sig !== expectedSig) return null;
  try {
    const raw = fromBase64Url(encoded);
    const payload = JSON.parse(raw);
    if (!payload || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Middleware: Require Staff Token (Works seamlessly across serverless & stateful)
function requireStaffAuth(req, res, next) {
  let token = req.headers['authorization'];
  if (token && token.startsWith('Bearer ')) {
    token = token.substring(7);
  }
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Sesi login tidak ditemukan. Silakan login kembali.' });
  }

  let session = staffSessions.get(token);
  if (!session) {
    const verified = verifyStaffToken(token);
    if (verified) {
      session = {
        growId: verified.growId,
        roleName: verified.roleName,
        roleLevel: verified.roleLevel,
        badge: verified.badge,
        isConfig: Boolean(verified.isConfig),
        expiresAt: verified.exp,
      };
      staffSessions.set(token, session);
    }
  }

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
      breakHits: 0,
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
    breakHits: Number(editEntry.Break_Hits) || 0,
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
        const remoteRes = await doHttpRequest(`${REMOTE_GAME_SERVER}/api/player/auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Token': PROJECT_D_ADMIN_TOKEN,
          },
          body: { growId: cleanId, password },
          timeout: 5000,
        });
        if (remoteRes.data && remoteRes.data.status === 'error') {
          return res.status(remoteRes.status || 403).json({
            status: 'error',
            message: remoteRes.data.message || 'Login gagal.',
          });
        }
        if (remoteRes.ok && remoteRes.data && remoteRes.data.status === 'ok') {
          const rData = remoteRes.data;
          const roles = rData.roles || {};
          playerData = {
            tankIDName: rData.growId || cleanId,
            pass: password,
            _remoteRoleInfo: roles,
          };
        }
      } catch {}
    }

    if (!playerData) {
      return res.status(404).json({
        status: 'error',
        message: `Akun GrowID "${cleanId}" tidak ditemukan di database server Project-D.`,
      });
    }

    // Verify Password (if verified locally)
    const storedPass = String(playerData.pass || '');
    if (storedPass !== password) {
      return res.status(401).json({
        status: 'error',
        message: 'Password salah! Periksa kembali password akun Growtopia Anda.',
      });
    }

    // Check Staff Role (strictly Level 10+ Staff up to Config)
    const roleInfo = checkStaffRole(playerData);
    if (!roleInfo.isStaff) {
      return res.status(403).json({
        status: 'error',
        message: `Akses Ditolak: Hanya role Staff sampai Config Access (Level 10+) yang dapat mengakses Web Editor. Akun Anda (${roleInfo.roleName} - Level ${roleInfo.roleLevel}) tidak memiliki izin.`,
      });
    }

    // Issue Stateless HMAC Token (works reliably across serverless instances)
    const realGrowId = playerData.tankIDName || cleanId;
    const sessionObj = {
      growId: realGrowId,
      roleName: roleInfo.roleName,
      roleLevel: roleInfo.roleLevel,
      badge: roleInfo.badge,
      isConfig: Boolean(roleInfo.isConfig),
    };
    const token = createStaffToken(sessionObj);
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    staffSessions.set(token, {
      ...sessionObj,
      expiresAt,
    });

    addAuditLog(realGrowId, roleInfo.roleName, 'STAFF_LOGIN', 'Berhasil login ke Web Admin Editor');

    return res.json({
      status: 'ok',
      message: `Selamat datang, ${realGrowId}!`,
      token,
      staff: sessionObj,
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
      isConfig: Boolean(req.staff.isConfig),
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
app.get('/api/items', requireStaffAuth, async (req, res) => {
  try {
    await refreshRemoteEditItemsIfNeeded();
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
app.get('/api/items/:id', requireStaffAuth, async (req, res) => {
  await refreshRemoteEditItemsIfNeeded();
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
      Break_Hits: Math.max(0, parseInt(b.breakHits !== undefined ? b.breakHits : (b.Break_Hits !== undefined ? b.Break_Hits : 0)) || 0),
      Far_Punch: Math.max(0, Math.min(25, parseInt(b.farPunch !== undefined ? b.farPunch : (b.Far_Punch !== undefined ? b.Far_Punch : 0)) || 0)),
      Punch_Place: Math.max(0, Math.min(25, parseInt(b.punchPlace !== undefined ? b.punchPlace : (b.Punch_Place !== undefined ? b.Punch_Place : 0)) || 0)),
      Punch_Hit: Math.max(0, Math.min(25, parseInt(b.punchHit !== undefined ? b.punchHit : (b.Punch_Hit !== undefined ? b.Punch_Hit : 0)) || 0)),
      Punch_Id: Math.max(0, parseInt(b.punchId !== undefined ? b.punchId : (b.Punch_Id !== undefined ? b.Punch_Id : 0)) || 0),
      Gems: Math.max(0, parseInt(b.gems !== undefined ? b.gems : (b.Gems !== undefined ? b.Gems : 0)) || 0),
      Xp: Math.max(0, parseInt(b.xp !== undefined ? b.xp : (b.Xp !== undefined ? b.Xp : 0)) || 0),
      Bonus: Math.max(0, parseInt(b.bonus !== undefined ? b.bonus : (b.Bonus !== undefined ? b.Bonus : 0)) || 0),
      Item_Price: Math.max(0, parseInt(b.itemPrice !== undefined ? b.itemPrice : (b.Item_Price !== undefined ? b.Item_Price : 0)) || 0),
      Change_Drop_Seeds: Math.max(0, Math.min(100, parseInt(b.changeDropSeeds !== undefined ? b.changeDropSeeds : (b.Change_Drop_Seeds !== undefined ? b.Change_Drop_Seeds : 0)) || 0)),
      Block_Chance: parseInt(b.blockChance !== undefined ? b.blockChance : (b.Block_Chance !== undefined ? b.Block_Chance : -1)),
      ExtraDropsMode: b.extraDropsMode ? 1 : (b.ExtraDropsMode ? 1 : 0),
      Extra_Drops: Array.isArray(b.extraDrops || b.Extra_Drops) ? (b.extraDrops || b.Extra_Drops).map((d) => [Number(d[0]), Number(d[1])]) : [],
      Extra_Chance: Array.isArray(b.extraChance || b.Extra_Chance) ? (b.extraChance || b.Extra_Chance).map((c) => Number(c)) : [],
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

    // Audit log description
    const staffName = req.staff.growId;
    const staffRole = req.staff.roleName;
    const actionDesc = updated.property_gacha
      ? `Set Block #${id} (${updated.Name}) menjadi GACHA dengan ${updated.Extra_Drops.length} hadiah drop`
      : `Update item #${id} (${updated.Name}) [BreakHits: ${updated.Break_Hits}, FarPunch: ${updated.Far_Punch}, FarPut: ${updated.Punch_Place}, Hit: ${updated.Punch_Hit}, xGems: ${updated.Gems}, xXP: ${updated.Xp}]`;

    let serverSync = false;
    const isVercel = Boolean(process.env.VERCEL) || !fs.existsSync('/root/downloads/Project-D');

    if (isVercel) {
      // Direct Remote Sync from Vercel to VPS Game Server with staff info
      const syncRes = await syncRemoteItem('save', {
        item: updated,
        staff: req.staff,
        details: actionDesc,
      });
      if (syncRes.ok) {
        serverSync = true;
      } else {
        console.warn('[VERCEL REMOTE SYNC WARNING]:', syncRes.error || syncRes.status);
      }
      try { saveEditItemv2(); } catch {}
    } else {
      // Save to disk locally on VPS
      const saved = saveEditItemv2();
      if (!saved) {
        return res.status(500).json({ status: 'error', message: 'Gagal menulis data ke database edit_itemv2.json.' });
      }

      // Notify Project-D C++ server for instant live in-game reload
      try {
        const cppPayload = {
          id,
          name: updated.Name,
          description: updated.Desc,
          rarity: updated.rarity,
          breakHits: updated.Break_Hits,
          farPunch: updated.Far_Punch,
          punchPlace: updated.Punch_Place,
          punchHit: updated.Punch_Hit,
          punchId: updated.Punch_Id,
          bonus: updated.Bonus,
          itemPrice: updated.Item_Price,
          max_gems: updated.Gems,
          xp: updated.Xp,
          farmable: updated.property_farmable,
          untradeable: updated.property_untradeable,
          blocked_place: updated.property_blocked,
          newdropchance: updated.Change_Drop_Seeds,
          property_gacha: updated.property_gacha,
          property_blacklist: updated.property_blacklist,
          property_unobtainable: updated.property_unobtainable,
          extraDrops: updated.Extra_Drops,
          extraChance: updated.Extra_Chance,
          extraDropsMode: updated.ExtraDropsMode,
          blockChance: updated.Block_Chance,
        };
        const syncRes = await notifyCppServer('/api/admin/items/save', cppPayload);
        serverSync = syncRes.ok;
      } catch {}
    }

    addAuditLog(staffName, staffRole, updated.property_gacha ? 'SET_GACHA' : 'SAVE_ITEM', actionDesc);

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
    const dictEntry = itemsDict[id];
    const itemName = dictEntry ? dictEntry.name : `Item #${id}`;
    const actionDesc = `Reset item #${id} (${itemName}) ke pengaturan bawaan server`;

    const isVercel = Boolean(process.env.VERCEL) || !fs.existsSync('/root/downloads/Project-D');

    if (isVercel) {
      // Remote reset on VPS Game Server
      await syncRemoteItem('reset', {
        id,
        staff: req.staff,
        details: actionDesc,
      });
      try { saveEditItemv2(); } catch {}
    } else {
      saveEditItemv2();
      // Notify Project-D C++ server
      try {
        await notifyCppServer('/api/admin/items/reset', { id });
      } catch {}
    }

    addAuditLog(req.staff.growId, req.staff.roleName, 'RESET_ITEM', actionDesc);

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

// 9. Audit Logs List (Full history of who changed what)
app.get('/api/logs', requireStaffAuth, async (req, res) => {
  try {
    let allLogs = [];
    const isVercel = Boolean(process.env.VERCEL) || !fs.existsSync('/root/downloads/Project-D');
    if (isVercel) {
      try {
        const remoteRes = await doHttpRequest(`${REMOTE_GAME_SERVER}/api/audit-logs`, {
          method: 'GET',
          headers: { 'X-Admin-Token': PROJECT_D_ADMIN_TOKEN },
          timeout: 4000,
        });
        if (remoteRes.ok && remoteRes.data && Array.isArray(remoteRes.data.logs)) {
          allLogs = remoteRes.data.logs;
        }
      } catch {}
    }

    if (allLogs.length === 0) {
      loadAuditLogs();
      allLogs = auditLogs;
    }

    // Role Config can see ALL logs from all staff!
    // Non-config staff can only see their own personal logs!
    const isConfig = Boolean(req.staff.isConfig);
    let filteredLogs = allLogs;
    if (!isConfig) {
      const myId = String(req.staff.growId || '').toLowerCase();
      filteredLogs = allLogs.filter((l) => String(l.growId || '').toLowerCase() === myId);
    }

    return res.json({
      status: 'ok',
      logs: filteredLogs,
      total: filteredLogs.length,
      allLogsCount: allLogs.length,
      isConfig,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Gagal memuat log aktivitas.' });
  }
});

// 10. Dashboard Statistics
app.get('/api/stats', requireStaffAuth, async (_req, res) => {
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

  let logsToReturn = auditLogs;
  const isVercel = Boolean(process.env.VERCEL) || !fs.existsSync('/root/downloads/Project-D');
  if (isVercel) {
    try {
      const remoteRes = await doHttpRequest(`${REMOTE_GAME_SERVER}/api/audit-logs`, {
        method: 'GET',
        headers: { 'X-Admin-Token': PROJECT_D_ADMIN_TOKEN },
        timeout: 3000,
      });
      if (remoteRes.ok && remoteRes.data && Array.isArray(remoteRes.data.logs)) {
        logsToReturn = remoteRes.data.logs;
      }
    } catch {}
  } else {
    loadAuditLogs();
    logsToReturn = auditLogs;
  }

  const isConfig = Boolean(req.staff && req.staff.isConfig);
  let recentLogsForUser = logsToReturn;
  if (!isConfig) {
    const myId = String((req.staff && req.staff.growId) || '').toLowerCase();
    recentLogsForUser = logsToReturn.filter((l) => String(l.growId || '').toLowerCase() === myId);
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
      totalLogsCount: recentLogsForUser.length,
      recentAuditLogs: recentLogsForUser.slice(0, 10),
    },
  });
});

// Fallback to index.html for SPA client-side routing
app.get('*', (_req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(200).send('<!DOCTYPE html><html><body><h1>Project-D Staff Item Editor</h1></body></html>');
});

// ============================================================================
// Server Listener & Export
// ============================================================================
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('================================================================');
    console.log(`  Project-D Web Admin Panel (Item & Clothes/Block Editor)`);
    console.log(`  Listening on http://localhost:${PORT}`);
    console.log(`  Items Dictionary : ${ITEMS_DICT_PATH}`);
    console.log(`  EditItem Database: ${EDIT_ITEM_PATH}`);
    console.log(`  Players Database : ${PLAYERS_DIR}`);
    console.log('================================================================');
  });
}

export default app;
