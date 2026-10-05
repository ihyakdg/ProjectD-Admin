// Project-D Studio | Game Asset & Item Workbench Client
let authToken = localStorage.getItem('projectd_staff_token') || '';
let currentStaff = null;
let currentItems = [];
let currentPage = 1;
let currentTotalPages = 1;
let currentCategory = 'all';
let currentSearch = '';
let currentEditingItem = null;
let punchEffects = [];
const itemLookupCache = new Map();

// ============================================================================
// GROWTOPIA COLOR PARSER & HELPERS
// ============================================================================
const GT_COLOR_CLASSES = {
  '0': 'gt-c-0',
  '1': 'gt-c-1',
  '2': 'gt-c-2',
  '3': 'gt-c-3',
  '4': 'gt-c-4',
  '5': 'gt-c-5',
  '6': 'gt-c-6',
  '7': 'gt-c-7',
  '8': 'gt-c-8',
  '9': 'gt-c-9',
  'b': 'gt-c-b',
  'p': 'gt-c-p',
  'w': 'gt-c-w',
  'o': 'gt-c-o',
  'c': 'gt-c-c',
};

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanGrowtopiaColors(str) {
  if (!str) return '';
  return String(str)
    .replace(/([a-zA-Z0-9])`[^\s`]([a-zA-Z0-9])/g, '$1 $2')
    .replace(/`[^\s`]/g, '')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderGtColors(rawText) {
  if (!rawText) return '';
  const str = String(rawText);
  let html = '';
  let curClass = 'text-white';
  let i = 0;

  while (i < str.length) {
    if (str[i] === '`' && i + 1 < str.length) {
      const code = str[i + 1].toLowerCase();
      if (GT_COLOR_CLASSES[code]) {
        curClass = GT_COLOR_CLASSES[code];
        i += 2;
        continue;
      }
    }

    let chunk = '';
    while (i < str.length && str[i] !== '`') {
      chunk += str[i];
      i++;
    }

    if (chunk) {
      html += `<span class="${curClass}">${escapeHtml(chunk)}</span>`;
    }

    if (i < str.length && str[i] === '`') {
      if (i + 1 >= str.length || !GT_COLOR_CLASSES[str[i + 1].toLowerCase()]) {
        html += `<span class="${curClass}">\`</span>`;
        i++;
      }
    }
  }

  return html || escapeHtml(cleanGrowtopiaColors(str));
}

// Copy ID to clipboard with toast
window.copyId = function (id) {
  navigator.clipboard.writeText(String(id)).then(() => {
    showToast(`Item ID #${id} disalin ke clipboard!`, 'info');
  }).catch(() => {});
};

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const isErr = type === 'error';
  const isInfo = type === 'info';
  const isWarn = type === 'warning';

  toast.className = `pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl shadow-xl text-xs font-medium transition-all duration-200 transform translate-y-2 opacity-0 border ${
    isErr
      ? 'bg-rose-950/90 text-rose-200 border-rose-500/40 shadow-rose-950/40'
      : isWarn
      ? 'bg-amber-950/90 text-amber-200 border-amber-500/40 shadow-amber-950/40'
      : isInfo
      ? 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-black/50'
      : 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40 shadow-emerald-950/40'
  }`;

  const icon = isErr
    ? '<i class="fa-solid fa-circle-exclamation text-rose-400 mt-0.5 text-sm shrink-0"></i>'
    : isWarn
    ? '<i class="fa-solid fa-triangle-exclamation text-amber-400 mt-0.5 text-sm shrink-0"></i>'
    : isInfo
    ? '<i class="fa-solid fa-circle-info text-sky-400 mt-0.5 text-sm shrink-0"></i>'
    : '<i class="fa-solid fa-circle-check text-emerald-400 mt-0.5 text-sm shrink-0"></i>';

  toast.innerHTML = `${icon}<span class="leading-relaxed">${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ============================================================================
// API CLIENT
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
      throw new Error(data.message || `Request gagal (${res.status})`);
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
      showToast(`Selamat datang, ${data.staff.growId}!`);
      onAuthSuccess();
    } else {
      throw new Error(data.message || 'Login gagal.');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>Otentikasi & Buka Studio</span><i class="fa-solid fa-arrow-right text-xs"></i>';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  if (confirm('Apakah Anda ingin keluar dari Studio?')) {
    logout();
  }
});

// ============================================================================
// PUNCH EFFECTS & DASHBOARD STATS
// ============================================================================
async function loadPunchEffects() {
  try {
    const data = await apiRequest('/api/effects/punch');
    if (data.status === 'ok' && Array.isArray(data.effects)) {
      punchEffects = data.effects;
      const select = document.getElementById('select-punch-id');
      select.innerHTML = punchEffects
        .map((ef) => `<option value="${ef.id}">#${ef.id} - ${ef.name}</option>`)
        .join('');
    }
  } catch {}
}

async function loadStats() {
  try {
    const data = await apiRequest('/api/stats');
    if (data.status === 'ok' && data.stats) {
      const s = data.stats;
      document.getElementById('stat-total-items').textContent = (s.totalDictItems || 31074).toLocaleString('en-US');
      document.getElementById('stat-custom-items').textContent = (s.totalCustomItems || 0).toLocaleString('en-US');
      document.getElementById('stat-gacha-blocks').textContent = (s.totalGachaBlocks || 0).toLocaleString('en-US');
      document.getElementById('stat-far-clothes').textContent = (s.clothesWithFarReach || 0).toLocaleString('en-US');
      if (document.getElementById('logs-count-badge')) {
        document.getElementById('logs-count-badge').textContent = s.totalLogsCount || 0;
      }
    }
  } catch {}
}

// ============================================================================
// CATALOG DATA FETCHING & RENDERING
// ============================================================================
async function loadItems(page = 1) {
  currentPage = page;
  const loadingEl = document.getElementById('items-loading');
  const gridEl = document.getElementById('items-grid');
  const emptyEl = document.getElementById('items-empty');
  const paginationWrapper = document.getElementById('pagination-wrapper');

  loadingEl.classList.remove('hidden');
  gridEl.classList.add('hidden');
  emptyEl.classList.add('hidden');

  try {
    const params = new URLSearchParams({
      page: String(page),
      limit: '30',
      category: currentCategory,
    });
    if (currentSearch) {
      params.append('search', currentSearch);
    }

    const data = await apiRequest(`/api/items?${params.toString()}`);
    loadingEl.classList.add('hidden');

    if (data.status === 'ok') {
      currentItems = data.items || [];
      currentPage = data.page || 1;
      currentTotalPages = data.totalPages || 1;

      if (currentItems.length === 0) {
        emptyEl.classList.remove('hidden');
        paginationWrapper.classList.add('hidden');
      } else {
        renderItemsGrid(currentItems);
        gridEl.classList.remove('hidden');
        paginationWrapper.classList.remove('hidden');
        updatePagination(currentPage, currentTotalPages);
      }
    }
  } catch (err) {
    loadingEl.classList.add('hidden');
    showToast(`Gagal memuat katalog: ${err.message}`, 'error');
  }
}

function renderItemsGrid(items) {
  const grid = document.getElementById('items-grid');
  grid.innerHTML = items
    .map((item) => {
      const isClothes = item.category === 'clothes';
      const isBlock = item.category === 'block';
      const isGacha = item.isGacha;
      const isEdited = item.isEdited;

      // Category Pill
      let catBadge = '';
      if (isGacha) {
        catBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-purple-500/15 text-purple-300 border border-purple-500/30">GACHA BOX</span>';
      } else if (isClothes) {
        catBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-sky-500/15 text-sky-300 border border-sky-500/30">WEARABLE</span>';
      } else if (isBlock) {
        catBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">BLOCK</span>';
      } else {
        catBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">ITEM</span>';
      }

      // Stat Tags
      const tags = [];
      if (item.breakHits > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700/80">Break: ${item.breakHits} Hits</span>`);
      if (item.farPunch > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">Punch: +${item.farPunch}</span>`);
      if (item.punchPlace > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">Place: +${item.punchPlace}</span>`);
      if (item.punchHit > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">Strength: ${item.punchHit}</span>`);
      if (item.gems > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">${item.gems}x Gems</span>`);
      if (item.xp > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">${item.xp}x EXP</span>`);
      if (item.extraDrops && item.extraDrops.length > 0) tags.push(`<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-200 border border-purple-500/30">${item.extraDrops.length} Drops Pool</span>`);

      const gtColoredName = renderGtColors(item.name);

      return `
        <div class="studio-card rounded-xl p-3.5 flex flex-col justify-between group ${
          isGacha ? 'border-purple-500/40 bg-[#121024]' : isEdited ? 'border-sky-500/30' : ''
        }">
          <div>
            <!-- Header Badges -->
            <div class="flex items-center justify-between gap-2 mb-2">
              <button type="button" onclick="copyId(${item.id})" title="Klik untuk salin ID #${item.id}"
                class="font-mono text-xs font-semibold text-slate-400 hover:text-sky-400 flex items-center gap-1 transition">
                <span>#${item.id}</span>
                <i class="fa-regular fa-copy text-[10px] opacity-50 group-hover:opacity-100"></i>
              </button>
              <div class="flex items-center gap-1.5">
                ${isEdited ? '<span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">CUSTOM</span>' : ''}
                ${catBadge}
              </div>
            </div>

            <!-- In-Game Name with authentic GT Colors -->
            <h3 class="text-xs sm:text-sm font-bold text-white line-clamp-1 break-words font-sans">
              ${gtColoredName}
            </h3>
            <p class="text-[11px] text-slate-500 font-mono line-clamp-1 mt-0.5">${escapeHtml(item.baseName)}</p>

            <!-- Stat Chips -->
            <div class="flex flex-wrap gap-1 mt-2.5 min-h-[22px]">
              ${tags.length > 0 ? tags.join('') : '<span class="text-[10px] text-slate-600 font-mono">Bawaan items.dat</span>'}
            </div>
          </div>

          <!-- Bottom Footer -->
          <div class="mt-3.5 pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
            <span class="text-[10px] text-slate-500 font-mono">Rarity: ${item.rarity}</span>
            <button onclick="openEditModal(${item.id})"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 text-xs font-semibold transition flex items-center gap-1.5 shadow-sm">
              <i class="fa-solid fa-sliders text-[10px]"></i>
              <span>Inspect</span>
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
// FILTER PILLS & SEARCH
// ============================================================================
document.querySelectorAll('.filter-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach((b) => {
      b.className = 'filter-tab px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800';
    });
    btn.className = 'filter-tab px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-sky-600 text-white shadow-sm';
    currentCategory = btn.getAttribute('data-cat') || 'all';
    loadItems(1);
  });
});

let searchTimeout = null;
const searchInput = document.getElementById('item-search');
const searchClearBtn = document.getElementById('search-clear-btn');

searchInput.addEventListener('input', (e) => {
  const val = e.target.value;
  if (val) {
    searchClearBtn.classList.remove('hidden');
  } else {
    searchClearBtn.classList.add('hidden');
  }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = val.trim();
    loadItems(1);
  }, 300);
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.classList.add('hidden');
  currentSearch = '';
  loadItems(1);
  searchInput.focus();
});

// ============================================================================
// STEPPER NUMBER HELPER
// ============================================================================
window.stepNumber = function (inputId, step, min, max) {
  const el = document.getElementById(inputId);
  if (!el) return;
  let val = parseInt(el.value) || 0;
  val = Math.max(min, Math.min(max, val + step));
  el.value = val;
  el.dispatchEvent(new Event('input'));
};

// ============================================================================
// ITEM INSPECTOR MODAL LOGIC
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
  document.getElementById('modal-item-badge').textContent = `#${item.id}`;
  document.getElementById('modal-item-title').innerHTML = renderGtColors(item.name);
  document.getElementById('modal-item-subtitle').textContent = `Bawaan: ${item.baseName} | Kategori: ${item.category.toUpperCase()}`;

  const editedPill = document.getElementById('modal-item-edited-pill');
  if (item.isEdited) {
    editedPill.classList.remove('hidden');
  } else {
    editedPill.classList.add('hidden');
  }

  // Combat / Wearable values
  document.getElementById('num-far-place').value = item.punchPlace || 0;
  document.getElementById('num-far-punch').value = item.farPunch || 0;
  document.getElementById('num-punch-hit').value = item.punchHit || 0;
  document.getElementById('num-gems').value = item.gems || 0;
  document.getElementById('num-xp').value = item.xp || 0;
  document.getElementById('select-punch-id').value = item.punchId || 0;

  // Gacha & Blocks
  document.getElementById('check-gacha').checked = Boolean(item.isGacha);
  document.getElementById('check-farmable').checked = Boolean(item.property_farmable);
  document.getElementById('check-blocked').checked = Boolean(item.property_blocked);
  document.getElementById('input-break-hits').value = item.breakHits || 0;
  document.getElementById('input-seed-chance').value = item.changeDropSeeds || 0;
  document.getElementById('input-block-chance').value = item.blockChance !== undefined ? item.blockChance : -1;

  // Render Extra Drops
  renderGachaDrops(item.extraDrops || [], item.extraChance || []);

  // General tab
  const nameInput = document.getElementById('input-item-name');
  nameInput.value = item.name !== item.baseName ? item.name : '';
  updateNameLivePreview(nameInput.value || item.baseName);

  document.getElementById('input-item-desc').value = item.desc || '';
  document.getElementById('input-rarity').value = item.rarity || 0;
  document.getElementById('input-price').value = item.itemPrice || 0;
  document.getElementById('check-untradeable').checked = Boolean(item.property_untradeable);
  document.getElementById('check-blacklist').checked = Boolean(item.property_blacklist);
  document.getElementById('check-unobtainable').checked = Boolean(item.property_unobtainable);

  // Switch to relevant tab
  if ((item.category === 'block' || item.isGacha) && !item.farPunch && !item.punchPlace) {
    switchModalTab('block');
  } else {
    switchModalTab('clothes');
  }
}

// Live preview for custom in-game name
function updateNameLivePreview(text) {
  const preview = document.getElementById('name-live-preview');
  if (!preview) return;
  preview.innerHTML = renderGtColors(text || 'Default Name');
}

document.getElementById('input-item-name').addEventListener('input', (e) => {
  updateNameLivePreview(e.target.value || (currentEditingItem ? currentEditingItem.baseName : ''));
});

// Modal Tabs
function switchModalTab(tab) {
  const tabs = ['clothes', 'block', 'general'];
  tabs.forEach((t) => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const panel = document.getElementById(`panel-${t}`);
    if (t === tab) {
      btn.className = 'modal-tab-btn py-2 px-3 text-xs font-semibold border-b-2 border-sky-500 text-sky-400';
      panel.classList.remove('hidden');
    } else {
      btn.className = 'modal-tab-btn py-2 px-3 text-xs font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200';
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
// STUDIO PRESETS ENGINE
// ============================================================================
window.applyPreset = function (presetType) {
  if (!currentEditingItem) return;

  if (presetType === 'rayman') {
    document.getElementById('num-far-punch').value = 10;
    document.getElementById('num-far-place').value = 10;
    document.getElementById('num-punch-hit').value = 1;
    document.getElementById('num-gems').value = 50;
    document.getElementById('select-punch-id').value = 80;
    switchModalTab('clothes');
    showToast('Preset Rayman Reach (+10 Far, 1-Hit, 50x Gems) diterapkan!', 'info');
  } else if (presetType === 'instabreak') {
    document.getElementById('num-punch-hit').value = 1;
    switchModalTab('clothes');
    showToast('Preset 1-Hit Instant Break diterapkan!', 'info');
  } else if (presetType === 'gemsfarm') {
    document.getElementById('num-gems').value = 50;
    document.getElementById('num-xp').value = 10;
    document.getElementById('check-farmable').checked = true;
    switchModalTab('clothes');
    showToast('Preset High-Yield Farm (50x Gems, 10x EXP, Farmable) diterapkan!', 'info');
  } else if (presetType === 'gachabox') {
    document.getElementById('check-gacha').checked = true;
    switchModalTab('block');
    const existingRows = document.querySelectorAll('.gacha-drop-row');
    if (existingRows.length === 0) {
      quickAddCurrencyDrop(242, 'World Lock');
      quickAddCurrencyDrop(1796, 'Diamond Lock');
    }
    showToast('Block dikonfigurasi sebagai Gacha Box! Silakan atur hadiah drop.', 'info');
  }
};

// ============================================================================
// GACHA DROPS POOL BUILDER & LIVE RESOLUTION
// ============================================================================
async function lookupItemName(id) {
  const numId = Number(id);
  if (!numId || numId <= 0) return null;
  if (itemLookupCache.has(numId)) return itemLookupCache.get(numId);

  try {
    const res = await apiRequest(`/api/items/lookup/${numId}`);
    if (res && res.status === 'ok') {
      itemLookupCache.set(numId, res);
      return res;
    }
  } catch {}
  return null;
}

function updateGachaTotal() {
  let totalChance = 0;
  document.querySelectorAll('.drop-chance').forEach((inp) => {
    totalChance += parseInt(inp.value) || 0;
  });

  const summary = document.getElementById('gacha-chance-summary');
  if (summary) {
    summary.textContent = `Total Peluang: ${totalChance}%`;
    if (totalChance === 100) {
      summary.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    } else {
      summary.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-500/30';
    }
  }
}

function renderGachaDrops(drops, chances) {
  const container = document.getElementById('gacha-drops-list');
  container.innerHTML = '';

  if (!drops || drops.length === 0) {
    container.innerHTML = `
      <div class="py-4 text-center text-xs text-slate-500 italic bg-slate-900/40 rounded-xl border border-dashed border-slate-800">
        Belum ada drop hadiah gacha. Klik "+ Hadiah" atau tombol cepat di atas untuk menambahkan hadiah.
      </div>
    `;
    updateGachaTotal();
    return;
  }

  drops.forEach((d, idx) => {
    const itemId = d[0] || 0;
    const count = d[1] || 1;
    const chance = chances && chances[idx] !== undefined ? chances[idx] : 10;
    appendGachaDropRow(container, itemId, count, chance, idx + 1);
  });

  updateGachaTotal();
}

function appendGachaDropRow(container, itemId, count, chance, index) {
  const emptyNote = container.querySelector('div.text-center');
  if (emptyNote) emptyNote.remove();

  const row = document.createElement('div');
  row.className = 'gacha-drop-row p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2';
  row.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-6 h-6 rounded bg-purple-500/10 text-purple-400 font-mono font-bold text-xs flex items-center justify-center shrink-0">
        #${index}
      </span>
      <div class="flex-1 flex items-center gap-2">
        <input type="number" placeholder="Item ID (cth: 242)" value="${itemId || ''}"
          class="drop-item-id w-28 bg-slate-950 border border-slate-700 rounded-lg py-1 px-2 text-xs text-white font-mono focus:border-purple-500">
        <span class="drop-item-resolved text-[11px] font-mono text-slate-400 truncate flex-1">
          <i class="fa-solid fa-spinner fa-spin text-[10px]"></i> Memuat nama...
        </span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <span class="text-[10px] text-slate-500 font-mono">Jml:</span>
        <input type="number" min="1" max="200" value="${count}"
          class="drop-count w-16 bg-slate-950 border border-slate-700 rounded-lg py-1 px-2 text-xs text-center text-white font-mono focus:border-purple-500">
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <span class="text-[10px] text-slate-500 font-mono">Peluang:</span>
        <input type="number" min="0" max="100" value="${chance}"
          class="drop-chance w-14 bg-slate-950 border border-slate-700 rounded-lg py-1 px-1.5 text-xs text-center text-purple-300 font-mono focus:border-purple-500">
        <span class="text-[10px] text-slate-400 font-mono">%</span>
      </div>
      <button type="button" class="btn-remove-drop w-7 h-7 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition shrink-0" title="Hapus Hadiah">
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>
  `;

  container.appendChild(row);

  const idInput = row.querySelector('.drop-item-id');
  const resolvedLabel = row.querySelector('.drop-item-resolved');
  const chanceInput = row.querySelector('.drop-chance');
  const removeBtn = row.querySelector('.btn-remove-drop');

  const updateItemName = async (idVal) => {
    if (!idVal || idVal <= 0) {
      resolvedLabel.textContent = 'Masukkan Item ID';
      resolvedLabel.className = 'drop-item-resolved text-[11px] font-mono text-slate-500 truncate flex-1';
      return;
    }
    const info = await lookupItemName(idVal);
    if (info && info.found) {
      resolvedLabel.innerHTML = `<span class="text-slate-200 font-semibold">${renderGtColors(info.name)}</span> <span class="text-slate-500 text-[10px]">(Rarity: ${info.rarity})</span>`;
    } else {
      resolvedLabel.textContent = `Item #${idVal} (Unknown)`;
      resolvedLabel.className = 'drop-item-resolved text-[11px] font-mono text-amber-400/80 truncate flex-1';
    }
  };

  updateItemName(itemId);

  let idDebounce = null;
  idInput.addEventListener('input', (e) => {
    clearTimeout(idDebounce);
    idDebounce = setTimeout(() => {
      updateItemName(parseInt(e.target.value) || 0);
    }, 250);
  });

  chanceInput.addEventListener('input', updateGachaTotal);

  removeBtn.addEventListener('click', () => {
    row.remove();
    updateGachaTotal();
    // Renumber rows
    const rows = container.querySelectorAll('.gacha-drop-row');
    if (rows.length === 0) {
      container.innerHTML = `
        <div class="py-4 text-center text-xs text-slate-500 italic bg-slate-900/40 rounded-xl border border-dashed border-slate-800">
          Belum ada drop hadiah gacha. Klik "+ Hadiah" atau tombol cepat di atas untuk menambahkan hadiah.
        </div>
      `;
    } else {
      rows.forEach((r, i) => {
        r.querySelector('span.w-6').textContent = `#${i + 1}`;
      });
    }
  });
}

window.quickAddCurrencyDrop = function (itemId, name) {
  const container = document.getElementById('gacha-drops-list');
  const count = container.querySelectorAll('.gacha-drop-row').length + 1;
  appendGachaDropRow(container, itemId, 1, 10, count);
  updateGachaTotal();
  showToast(`Ditambahkan ${name} (#${itemId}) ke drop pool!`, 'info');
};

document.getElementById('btn-add-drop').addEventListener('click', () => {
  const container = document.getElementById('gacha-drops-list');
  const count = container.querySelectorAll('.gacha-drop-row').length + 1;
  appendGachaDropRow(container, '', 1, 10, count);
  updateGachaTotal();
});

// ============================================================================
// SAVE ITEM CHANGES
// ============================================================================
document.getElementById('btn-save-item').addEventListener('click', async () => {
  if (!currentEditingItem) return;

  const btn = document.getElementById('btn-save-item');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Menerapkan ke Game...</span>';

  try {
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
      breakHits: parseInt(document.getElementById('input-break-hits').value) || 0,
      itemPrice: parseInt(document.getElementById('input-price').value) || 0,
      farPunch: parseInt(document.getElementById('num-far-punch').value) || 0,
      punchPlace: parseInt(document.getElementById('num-far-place').value) || 0,
      punchHit: parseInt(document.getElementById('num-punch-hit').value) || 0,
      gems: parseInt(document.getElementById('num-gems').value) || 0,
      xp: parseInt(document.getElementById('num-xp').value) || 0,
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
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk text-xs"></i><span>Simpan & Terapkan Live</span>';
  }
});

// ============================================================================
// RESET ITEM TO DEFAULT
// ============================================================================
document.getElementById('btn-reset-item').addEventListener('click', async () => {
  if (!currentEditingItem) return;

  if (!confirm(`Reset item #${currentEditingItem.id} (${currentEditingItem.baseName}) ke bawaan game core?`)) {
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
let isCurrentUserConfig = false;

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
    return '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">SAVE</span>';
  }
  if (act === 'SET_GACHA') {
    return '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">GACHA</span>';
  }
  if (act === 'RESET_ITEM') {
    return '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">RESET</span>';
  }
  if (act === 'STAFF_LOGIN') {
    return '<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">LOGIN</span>';
  }
  return `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-400">${act}</span>`;
}

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
    totalEl.textContent = `${filtered.length} logs`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500">
        <i class="fa-regular fa-clipboard text-2xl mb-1 text-slate-600 block"></i>
        Belum ada riwayat aktivitas yang cocok.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((log) => {
    const timeFormatted = formatLogTimestamp(log.timestamp);
    const ago = timeAgo(log.timestamp);
    const badgeHtml = getActionBadge(log.action);
    const growId = log.growId || 'Staff';
    const role = log.role || 'Staff';

    return `
      <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-mono font-bold">
              ${growId.charAt(0).toUpperCase()}
            </span>
            <span class="font-bold text-slate-200 text-xs">${escapeHtml(growId)}</span>
            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800">${escapeHtml(role)}</span>
            ${badgeHtml}
          </div>
          <div class="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
            <span>${timeFormatted}</span>
            <span class="text-slate-600">(${ago})</span>
          </div>
        </div>
        <p class="text-xs text-slate-300 pl-8 leading-relaxed font-sans">
          ${escapeHtml(log.details || '')}
        </p>
      </div>
    `;
  }).join('');
}

async function openLogsModal() {
  const modal = document.getElementById('logs-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  try {
    const data = await apiRequest('/api/logs');
    if (data.status === 'ok') {
      auditLogsList = data.logs || [];
      isCurrentUserConfig = Boolean(data.isConfig);
      const searchVal = document.getElementById('log-search-input')?.value || '';
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
  document.getElementById('logs-modal').classList.add('hidden');
}

document.getElementById('open-logs-btn').addEventListener('click', openLogsModal);
document.getElementById('btn-close-logs-modal').addEventListener('click', closeLogsModal);
document.getElementById('btn-refresh-logs').addEventListener('click', async () => {
  await openLogsModal();
  showToast('Logs diperbarui!');
});

document.getElementById('log-search-input').addEventListener('input', (e) => {
  renderLogs(e.target.value);
});

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================
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

// Initialize Studio
initAuth();
