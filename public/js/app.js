// Project-D Staff Item & Clothes/Block Editor Client
let authToken = localStorage.getItem('projectd_staff_token') || '';
let currentStaff = null;
let currentItems = [];
let currentPage = 1;
let currentTotalPages = 1;
let currentCategory = 'all';
let currentSearch = '';
let currentEditingItem = null;
let punchEffects = [];

// ============================================================================
// TOAST NOTIFICATION HELPER
// ============================================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const isErr = type === 'error';
  const isWarn = type === 'warning';
  
  toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold transition-all duration-300 transform translate-y-2 opacity-0 border ${
    isErr
      ? 'bg-rose-950/90 text-rose-200 border-rose-500/40 shadow-rose-950/50'
      : isWarn
      ? 'bg-amber-950/90 text-amber-200 border-amber-500/40 shadow-amber-950/50'
      : 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40 shadow-emerald-950/50'
  }`;

  const icon = isErr
    ? '<i class="fa-solid fa-circle-exclamation text-rose-400 text-sm"></i>'
    : isWarn
    ? '<i class="fa-solid fa-triangle-exclamation text-amber-400 text-sm"></i>'
    : '<i class="fa-solid fa-circle-check text-emerald-400 text-sm"></i>';

  toast.innerHTML = `${icon}<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================================
// API REQUEST HELPER
// ============================================================================
async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(endpoint, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        logout();
      }
      throw new Error(data.message || `Request failed with status ${res.status}`);
    }
    return data;
  } catch (err) {
    throw err;
  }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================
async function initAuth() {
  if (!authToken) {
    showLoginModal();
    return;
  }

  try {
    const data = await apiRequest('/api/auth/me');
    if (data.status === 'ok' && data.staff) {
      currentStaff = data.staff;
      onAuthSuccess();
    } else {
      logout();
    }
  } catch {
    logout();
  }
}

function showLoginModal() {
  document.getElementById('login-modal').classList.remove('hidden');
  document.getElementById('app-wrapper').classList.add('hidden');
}

function onAuthSuccess() {
  document.getElementById('login-modal').classList.add('hidden');
  document.getElementById('app-wrapper').classList.remove('hidden');

  document.getElementById('staff-name-display').textContent = currentStaff.growId;
  document.getElementById('staff-role-display').textContent = currentStaff.badge || currentStaff.roleName;

  loadPunchEffects();
  loadStats();
  loadItems(1);
}

function logout() {
  if (authToken) {
    apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
  authToken = '';
  currentStaff = null;
  localStorage.removeItem('projectd_staff_token');
  showLoginModal();
}

// Handle Login Form Submit
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const growId = document.getElementById('login-growid').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');

  if (!growId || !password) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Memverifikasi Akun...</span>';

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ growId, password }),
    });

    if (data.status === 'ok' && data.token) {
      authToken = data.token;
      localStorage.setItem('projectd_staff_token', authToken);
      currentStaff = data.staff;
      showToast(`Selamat datang kembali, ${data.staff.growId}!`);
      onAuthSuccess();
    } else {
      throw new Error(data.message || 'Login gagal.');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Masuk ke Staff Panel</span><i class="fa-solid fa-arrow-right"></i>';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  if (confirm('Apakah Anda yakin ingin logout dari Staff Panel?')) {
    logout();
    showToast('Berhasil logout.');
  }
});

// ============================================================================
// DATA LOADERS
// ============================================================================
async function loadPunchEffects() {
  try {
    const data = await apiRequest('/api/items/punch-effects');
    if (data.status === 'ok') {
      punchEffects = data.effects || [];
      const select = document.getElementById('select-punch-id');
      select.innerHTML = punchEffects
        .map((p) => `<option value="${p.id}">${p.id} - ${p.name}</option>`)
        .join('');
    }
  } catch {}
}

async function loadStats() {
  try {
    const data = await apiRequest('/api/stats');
    if (data.status === 'ok' && data.stats) {
      const s = data.stats;
      document.getElementById('stat-total-items').textContent = Number(s.totalDictItems || 31074).toLocaleString();
      document.getElementById('stat-custom-items').textContent = Number(s.totalCustomItems || 0).toLocaleString();
      document.getElementById('stat-gacha-blocks').textContent = Number(s.totalGachaBlocks || 0).toLocaleString();
      document.getElementById('stat-far-clothes').textContent = Number(s.clothesWithFarReach || 0).toLocaleString();
      if (document.getElementById('logs-count-badge')) {
        document.getElementById('logs-count-badge').textContent = s.totalLogsCount !== undefined ? s.totalLogsCount : (s.recentAuditLogs ? s.recentAuditLogs.length : 0);
      }
    }
  } catch {}
}

async function loadItems(page = 1) {
  const loading = document.getElementById('items-loading');
  const grid = document.getElementById('items-grid');
  const empty = document.getElementById('items-empty');
  const pagination = document.getElementById('pagination-wrapper');

  loading.classList.remove('hidden');
  grid.classList.add('hidden');
  empty.classList.add('hidden');
  pagination.classList.add('hidden');

  try {
    const params = new URLSearchParams({
      page: String(page),
      limit: '30',
      category: currentCategory,
    });
    if (currentSearch) params.append('search', currentSearch);

    const data = await apiRequest(`/api/items?${params.toString()}`);

    loading.classList.add('hidden');

    if (data.status === 'ok' && data.items && data.items.length > 0) {
      currentItems = data.items;
      currentPage = data.page;
      currentTotalPages = data.totalPages;

      renderItemsGrid(currentItems);
      updatePagination(data.page, data.totalPages);
      grid.classList.remove('hidden');
      pagination.classList.remove('hidden');
    } else {
      empty.classList.remove('hidden');
    }
  } catch (err) {
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
    showToast(`Gagal memuat item: ${err.message}`, 'error');
  }
}

// ============================================================================
// RENDER ITEMS GRID
// ============================================================================
function cleanGrowtopiaColors(str) {
  if (!str) return '';
  return str.replace(/`[0-9a-zA-Z!@#$%^&*()_+={}\[\]:;"'<>?,.\/\\|~`]/g, '');
}

function renderItemsGrid(items) {
  const grid = document.getElementById('items-grid');
  grid.innerHTML = items
    .map((item) => {
      const isClothes = item.category === 'clothes';
      const isBlock = item.category === 'block';
      const isGacha = item.isGacha;
      const isEdited = item.isEdited;

      // Badges
      let catBadge = '';
      if (isGacha) {
        catBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">🎁 GACHA BLOCK</span>';
      } else if (isClothes) {
        catBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">👕 CLOTHES</span>';
      } else if (isBlock) {
        catBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">🧱 BLOCK</span>';
      } else {
        catBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-800 text-slate-400 border border-slate-700">ITEM</span>';
      }

      // Stat Tags
      const tags = [];
      if (item.farPunch > 0) tags.push(`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Punch Reach: +${item.farPunch}</span>`);
      if (item.punchPlace > 0) tags.push(`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Place Reach: +${item.punchPlace}</span>`);
      if (item.punchHit > 0) tags.push(`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">Hits: ${item.punchHit}</span>`);
      if (item.gems > 0) tags.push(`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">${item.gems}x Gems</span>`);
      if (item.xp > 0) tags.push(`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">${item.xp}x EXP</span>`);
      if (item.extraDrops && item.extraDrops.length > 0) tags.push(`<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">${item.extraDrops.length} Drops</span>`);

      const cleanTitle = cleanGrowtopiaColors(item.name);

      return `
        <div class="glass-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 relative group ${
          isGacha ? 'border-purple-500/40 shadow-lg shadow-purple-950/20' : isEdited ? 'border-emerald-500/30' : ''
        }">
          <div>
            <!-- Top Badges -->
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-mono text-xs font-black text-slate-400">#${item.id}</span>
              <div class="flex items-center gap-1.5">
                ${isEdited ? '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Custom Modified"></span>' : ''}
                ${catBadge}
              </div>
            </div>

            <!-- Title & Original Name -->
            <h3 class="text-sm font-black text-white group-hover:text-emerald-300 transition line-clamp-1" title="${cleanTitle}">
              ${cleanTitle}
            </h3>
            <p class="text-[11px] text-slate-500 font-mono line-clamp-1 mt-0.5">${item.baseName}</p>

            <!-- Stat tags preview -->
            <div class="flex flex-wrap gap-1.5 mt-3 min-h-[26px]">
              ${tags.length > 0 ? tags.join('') : '<span class="text-[10px] text-slate-600 italic">Pengaturan Bawaan</span>'}
            </div>
          </div>

          <!-- Bottom Action -->
          <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <span class="text-[11px] text-slate-400 font-mono">Rarity: ${item.rarity}</span>
            <button onclick="openEditModal(${item.id})"
              class="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-200 text-xs font-bold transition flex items-center gap-1.5 group-hover:bg-emerald-500 group-hover:text-slate-950">
              <i class="fa-solid fa-pen-to-square"></i>
              <span>Edit Item</span>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function updatePagination(page, totalPages) {
  document.getElementById('page-info').textContent = `Halaman ${page} dari ${totalPages}`;
  document.getElementById('prev-page-btn').disabled = page <= 1;
  document.getElementById('next-page-btn').disabled = page >= totalPages;
}

document.getElementById('prev-page-btn').addEventListener('click', () => {
  if (currentPage > 1) loadItems(currentPage - 1);
});

document.getElementById('next-page-btn').addEventListener('click', () => {
  if (currentPage < currentTotalPages) loadItems(currentPage + 1);
});

// ============================================================================
// FILTER TABS & SEARCH
// ============================================================================
document.querySelectorAll('.filter-tab').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-tab').forEach((b) => {
      b.className = 'filter-tab px-3.5 py-2 rounded-xl text-xs font-bold transition bg-slate-800/80 text-slate-300 hover:bg-slate-700';
    });
    btn.className = 'filter-tab px-3.5 py-2 rounded-xl text-xs font-bold transition bg-emerald-500 text-slate-950 shadow-md';
    currentCategory = btn.getAttribute('data-cat') || 'all';
    loadItems(1);
  });
});

let searchTimeout = null;
document.getElementById('item-search').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = e.target.value.trim();
    loadItems(1);
  }, 350);
});

// ============================================================================
// ITEM EDIT MODAL LOGIC
// ============================================================================
window.openEditModal = async function (itemId) {
  try {
    const data = await apiRequest(`/api/items/${itemId}`);
    if (data.status !== 'ok' || !data.item) {
      throw new Error(data.message || 'Item tidak ditemukan.');
    }

    currentEditingItem = data.item;
    populateModalFields(currentEditingItem);

    document.getElementById('edit-modal').classList.remove('hidden');
  } catch (err) {
    showToast(`Gagal membuka item: ${err.message}`, 'error');
  }
};

function populateModalFields(item) {
  document.getElementById('modal-item-badge').textContent = `ID: #${item.id}`;
  document.getElementById('modal-item-title').textContent = cleanGrowtopiaColors(item.name);
  document.getElementById('modal-item-subtitle').textContent = `Bawaan Server: ${item.baseName} | Kategori: ${item.category.toUpperCase()}`;

  // Sliders & Values
  setSlider('input-far-place', 'label-far-place', item.punchPlace, 'Blocks');
  setSlider('input-far-punch', 'label-far-punch', item.farPunch, 'Blocks');
  setSlider('input-punch-hit', 'label-punch-hit', item.punchHit, 'Hits');
  setSlider('input-gems', 'label-gems', item.gems, 'x Gems');
  setSlider('input-xp', 'label-xp', item.xp, 'x EXP');

  // Punch Effect
  document.getElementById('select-punch-id').value = item.punchId || 0;

  // Gacha & Blocks
  const checkGacha = document.getElementById('check-gacha');
  checkGacha.checked = Boolean(item.isGacha);
  document.getElementById('check-farmable').checked = Boolean(item.property_farmable);
  document.getElementById('check-blocked').checked = Boolean(item.property_blocked);
  document.getElementById('input-seed-chance').value = item.changeDropSeeds || 0;
  document.getElementById('input-block-chance').value = item.blockChance !== undefined ? item.blockChance : -1;

  // Render Extra Drops
  renderGachaDrops(item.extraDrops || [], item.extraChance || []);

  // General tab
  document.getElementById('input-item-name').value = item.name !== item.baseName ? item.name : '';
  document.getElementById('input-item-desc').value = item.desc || '';
  document.getElementById('input-rarity').value = item.rarity || 0;
  document.getElementById('input-price').value = item.itemPrice || 0;
  document.getElementById('check-untradeable').checked = Boolean(item.property_untradeable);
  document.getElementById('check-blacklist').checked = Boolean(item.property_blacklist);
  document.getElementById('check-unobtainable').checked = Boolean(item.property_unobtainable);

  // Switch to relevant tab: if block -> tab-block, else -> tab-clothes
  if (item.category === 'block' || item.isGacha) {
    switchModalTab('block');
  } else {
    switchModalTab('clothes');
  }
}

function setSlider(inputId, labelId, value, unit) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  input.value = value || 0;
  label.textContent = `${value || 0} ${unit}`;
}

// Link sliders to labels
['input-far-place:label-far-place:Blocks', 'input-far-punch:label-far-punch:Blocks', 'input-punch-hit:label-punch-hit:Hits', 'input-gems:label-gems:x Gems', 'input-xp:label-xp:x EXP'].forEach((def) => {
  const [inpId, lblId, unit] = def.split(':');
  document.getElementById(inpId).addEventListener('input', (e) => {
    document.getElementById(lblId).textContent = `${e.target.value} ${unit}`;
  });
});

// Modal Tabs
function switchModalTab(tab) {
  const tabs = ['clothes', 'block', 'general'];
  tabs.forEach((t) => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const panel = document.getElementById(`panel-${t}`);
    if (t === tab) {
      btn.className = 'modal-tab-btn py-2.5 px-4 text-xs font-bold border-b-2 border-emerald-500 text-emerald-400';
      panel.classList.remove('hidden');
    } else {
      btn.className = 'modal-tab-btn py-2.5 px-4 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200';
      panel.classList.add('hidden');
    }
  });
}

document.getElementById('tab-btn-clothes').addEventListener('click', () => switchModalTab('clothes'));
document.getElementById('tab-btn-block').addEventListener('click', () => switchModalTab('block'));
document.getElementById('tab-btn-general').addEventListener('click', () => switchModalTab('general'));

// Close Modal
function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  currentEditingItem = null;
}
document.getElementById('close-modal-btn').addEventListener('click', closeEditModal);
document.getElementById('btn-cancel-modal').addEventListener('click', closeEditModal);

// ============================================================================
// GACHA DROPS TABLE BUILDER
// ============================================================================
function renderGachaDrops(drops, chances) {
  const container = document.getElementById('gacha-drops-list');
  container.innerHTML = '';

  if (!drops || drops.length === 0) {
    container.innerHTML = `
      <div class="py-4 text-center text-xs text-slate-500 italic bg-slate-900/50 rounded-lg border border-dashed border-slate-800">
        Belum ada drop hadiah gacha. Klik "+ Tambah Hadiah" untuk membuat drop pool.
      </div>
    `;
    return;
  }

  drops.forEach((d, idx) => {
    const itemId = d[0] || 0;
    const count = d[1] || 1;
    const chance = chances && chances[idx] !== undefined ? chances[idx] : 10;

    const row = document.createElement('div');
    row.className = 'gacha-drop-row flex items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs';
    row.innerHTML = `
      <div class="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-mono font-bold">
        ${idx + 1}
      </div>
      <div class="flex-1">
        <input type="number" placeholder="Item ID" value="${itemId}" class="drop-item-id w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-xs text-white font-mono focus:border-purple-500">
      </div>
      <div class="w-24">
        <input type="number" min="1" max="200" placeholder="Count" value="${count}" class="drop-count w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-xs text-white font-mono focus:border-purple-500" title="Jumlah Item">
      </div>
      <div class="w-28 flex items-center gap-1">
        <input type="number" min="0" max="100" placeholder="Chance %" value="${chance}" class="drop-chance w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-white font-mono focus:border-purple-500" title="Peluang Drop (%)">
        <span class="text-slate-400 font-mono">%</span>
      </div>
      <button type="button" onclick="this.closest('.gacha-drop-row').remove()" class="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition" title="Hapus Hadiah">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;
    container.appendChild(row);
  });
}

document.getElementById('btn-add-drop').addEventListener('click', () => {
  const container = document.getElementById('gacha-drops-list');
  const emptyNote = container.querySelector('div.text-center');
  if (emptyNote) emptyNote.remove();

  const count = container.querySelectorAll('.gacha-drop-row').length + 1;
  const row = document.createElement('div');
  row.className = 'gacha-drop-row flex items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs';
  row.innerHTML = `
    <div class="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-mono font-bold">
      ${count}
    </div>
    <div class="flex-1">
      <input type="number" placeholder="Item ID (Contoh: 242)" value="" class="drop-item-id w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-xs text-white font-mono focus:border-purple-500">
    </div>
    <div class="w-24">
      <input type="number" min="1" max="200" placeholder="Jumlah" value="1" class="drop-count w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2.5 text-xs text-white font-mono focus:border-purple-500">
    </div>
    <div class="w-28 flex items-center gap-1">
      <input type="number" min="0" max="100" placeholder="Chance %" value="10" class="drop-chance w-full bg-slate-900 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-white font-mono focus:border-purple-500">
      <span class="text-slate-400 font-mono">%</span>
    </div>
    <button type="button" onclick="this.closest('.gacha-drop-row').remove()" class="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition">
      <i class="fa-solid fa-trash-can"></i>
    </button>
  `;
  container.appendChild(row);
});

// ============================================================================
// SAVE ITEM CHANGES
// ============================================================================
document.getElementById('btn-save-item').addEventListener('click', async () => {
  if (!currentEditingItem) return;

  const btn = document.getElementById('btn-save-item');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Menyimpan ke Server...</span>';

  try {
    // Collect drops
    const drops = [];
    const chances = [];
    document.querySelectorAll('.gacha-drop-row').forEach((row) => {
      const idVal = parseInt(row.querySelector('.drop-item-id').value);
      const countVal = Math.max(1, parseInt(row.querySelector('.drop-count').value) || 1);
      const chanceVal = Math.max(0, parseInt(row.querySelector('.drop-chance').value) || 10);
      if (!isNaN(idVal) && idVal > 0) {
        drops.push([idVal, countVal]);
        chances.push(chanceVal);
      }
    });

    const isGacha = document.getElementById('check-gacha').checked;
    const customName = document.getElementById('input-item-name').value.trim();

    const payload = {
      id: currentEditingItem.id,
      name: customName || currentEditingItem.baseName,
      desc: document.getElementById('input-item-desc').value.trim(),
      rarity: parseInt(document.getElementById('input-rarity').value) || 0,
      itemPrice: parseInt(document.getElementById('input-price').value) || 0,
      farPunch: parseInt(document.getElementById('input-far-punch').value) || 0,
      punchPlace: parseInt(document.getElementById('input-far-place').value) || 0,
      punchHit: parseInt(document.getElementById('input-punch-hit').value) || 0,
      gems: parseInt(document.getElementById('input-gems').value) || 0,
      xp: parseInt(document.getElementById('input-xp').value) || 0,
      punchId: parseInt(document.getElementById('select-punch-id').value) || 0,
      property_gacha: isGacha,
      extraDrops: drops,
      extraChance: chances,
      extraDropsMode: drops.length > 0 ? 1 : 0,
      property_farmable: document.getElementById('check-farmable').checked,
      property_blocked: document.getElementById('check-blocked').checked,
      changeDropSeeds: parseInt(document.getElementById('input-seed-chance').value) || 0,
      blockChance: parseInt(document.getElementById('input-block-chance').value) || -1,
      property_untradeable: document.getElementById('check-untradeable').checked,
      property_blacklist: document.getElementById('check-blacklist').checked,
      property_unobtainable: document.getElementById('check-unobtainable').checked,
    };

    const res = await apiRequest('/api/items/save', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (res.status === 'ok') {
      showToast(res.message);
      closeEditModal();
      loadStats();
      loadItems(currentPage);
    } else {
      throw new Error(res.message || 'Gagal menyimpan item.');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>Simpan & Terapkan Live</span>';
  }
});

// ============================================================================
// RESET ITEM TO DEFAULT
// ============================================================================
document.getElementById('btn-reset-item').addEventListener('click', async () => {
  if (!currentEditingItem) return;

  if (!confirm(`Apakah Anda yakin ingin me-reset item #${currentEditingItem.id} (${currentEditingItem.baseName}) ke pengaturan bawaan server?`)) {
    return;
  }

  const btn = document.getElementById('btn-reset-item');
  btn.disabled = true;

  try {
    const res = await apiRequest('/api/items/reset', {
      method: 'POST',
      body: JSON.stringify({ id: currentEditingItem.id }),
    });

    if (res.status === 'ok') {
      showToast(res.message);
      closeEditModal();
      loadStats();
      loadItems(currentPage);
    } else {
      throw new Error(res.message || 'Gagal mereset item.');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ============================================================================
// ACTIVITY & AUDIT LOGS
// ============================================================================
let auditLogsList = [];

function formatLogTimestamp(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} hari lalu`;
}

function getActionBadge(action) {
  const act = String(action || '').toUpperCase();
  if (act === 'SAVE_ITEM') {
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"><i class="fa-solid fa-floppy-disk"></i> SAVE ITEM</span>';
  }
  if (act === 'SET_GACHA') {
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/30 flex items-center gap-1"><i class="fa-solid fa-gift"></i> SET GACHA</span>';
  }
  if (act === 'RESET_ITEM') {
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1"><i class="fa-solid fa-arrow-rotate-left"></i> RESET ITEM</span>';
  }
  if (act === 'STAFF_LOGIN') {
    return '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 flex items-center gap-1"><i class="fa-solid fa-right-to-bracket"></i> LOGIN</span>';
  }
  return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-300 border border-slate-600">${act}</span>`;
}

let isCurrentUserConfig = false;

function renderLogs(filterQuery = '') {
  const container = document.getElementById('logs-container');
  if (!container) return;

  const query = String(filterQuery || '').trim().toLowerCase();
  const filtered = auditLogsList.filter((log) => {
    if (!query) return true;
    const str = `${log.growId} ${log.role} ${log.action} ${log.details}`.toLowerCase();
    return str.includes(query);
  });

  const totalEl = document.getElementById('modal-logs-total');
  if (totalEl) {
    if (isCurrentUserConfig) {
      totalEl.innerHTML = `<span class="text-amber-400 font-bold">🔑 Config View:</span> ${filtered.length} logs`;
    } else {
      totalEl.innerHTML = `<span class="text-blue-400 font-bold">🎖️ Personal View:</span> ${filtered.length} logs`;
    }
  }

  let noticeHtml = '';
  if (!isCurrentUserConfig) {
    noticeHtml = `
      <div class="p-3 mb-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 flex items-center gap-2">
        <i class="fa-solid fa-circle-info text-blue-400 text-sm"></i>
        <span><b>Mode Staff Biasa:</b> Anda hanya dapat melihat riwayat aktivitas akun Anda sendiri. Hak akses melihat seluruh log staf lain dipegang oleh Role Config.</span>
      </div>
    `;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      ${noticeHtml}
      <div class="py-16 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
        <i class="fa-regular fa-clipboard text-3xl text-slate-600"></i>
        <p class="text-xs font-semibold text-slate-300">Belum ada riwayat aktivitas yang cocok.</p>
        <p class="text-[11px] text-slate-500">Aktivitas staff seperti login, simpan item, dan reset akan tercatat otomatis di sini.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = noticeHtml + filtered.map((log) => {
    const timeFormatted = formatLogTimestamp(log.timestamp);
    const ago = timeAgo(log.timestamp);
    const badgeHtml = getActionBadge(log.action);
    const growId = log.growId || 'Unknown Staff';
    const role = log.role || 'Staff';

    return `
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 flex flex-col gap-2 transition">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold font-mono">
              ${growId.charAt(0).toUpperCase()}
            </span>
            <div>
              <span class="text-xs font-bold text-white">${growId}</span>
              <span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-mono">${role}</span>
            </div>
            ${badgeHtml}
          </div>
          <div class="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <span>${timeFormatted}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-500">${ago}</span>
          </div>
        </div>
        <div class="text-xs text-slate-300 pl-9 font-sans leading-relaxed">
          ${log.details || 'Tidak ada rincian keterangan.'}
        </div>
      </div>
    `;
  }).join('');
}

async function openLogsModal() {
  const modal = document.getElementById('logs-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const container = document.getElementById('logs-container');
  if (container) {
    container.innerHTML = `
      <div class="py-16 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
        <i class="fa-solid fa-circle-notch fa-spin text-2xl text-emerald-400"></i>
        <p class="text-xs font-semibold">Memuat riwayat log dari server Project-D...</p>
      </div>
    `;
  }

  try {
    const data = await apiRequest('/api/logs');
    if (data.status === 'ok') {
      auditLogsList = data.logs || [];
      isCurrentUserConfig = Boolean(data.isConfig);
      const searchVal = document.getElementById('log-search-input') ? document.getElementById('log-search-input').value : '';
      renderLogs(searchVal);
      if (document.getElementById('logs-count-badge')) {
        document.getElementById('logs-count-badge').textContent = auditLogsList.length;
      }
    }
  } catch (err) {
    showToast(`Gagal memuat logs: ${err.message}`, 'error');
  }
}

function closeLogsModal() {
  const modal = document.getElementById('logs-modal');
  if (modal) modal.classList.add('hidden');
}

if (document.getElementById('open-logs-btn')) {
  document.getElementById('open-logs-btn').addEventListener('click', openLogsModal);
}
if (document.getElementById('btn-close-logs-modal')) {
  document.getElementById('btn-close-logs-modal').addEventListener('click', closeLogsModal);
}
if (document.getElementById('btn-refresh-logs')) {
  document.getElementById('btn-refresh-logs').addEventListener('click', async () => {
    await openLogsModal();
    showToast('Log aktivitas berhasil diperbarui!');
  });
}
if (document.getElementById('log-search-input')) {
  document.getElementById('log-search-input').addEventListener('input', (e) => {
    renderLogs(e.target.value);
  });
}

// Keyboard shortcut: '/' focuses search
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('item-search').focus();
  }
  if (e.key === 'Escape') {
    closeEditModal();
    closeLogsModal();
  }
});

// Start initialization
initAuth();
