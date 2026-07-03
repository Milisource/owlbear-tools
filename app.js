import OBR, { buildImage } from 'https://esm.sh/@owlbear-rodeo/sdk@3.1.0';
import Fuse from 'https://esm.sh/fuse.js@7.0.0';

/*
 * 5e.tools mirrors the bestiary JSON and token images on separate GitHub repos.
 * The data repo:  5etools-mirror-3/5etools-src
 * The images repo: 5etools-mirror-2/5etools-img
 * Both serve with Access-Control-Allow-Origin: * so we can fetch them directly
 * from the browser without any proxy.  The main 5e.tools domain is behind
 * Cloudflare and doesn't set CORS headers — otherwise we could take it right
 * from the site.
 */
const BESTIARY_DIR = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary';
const TOKEN_BASE = 'https://raw.githubusercontent.com/5etools-mirror-2/5etools-img/main/bestiary/tokens';

/*
 * Namespace for the metadata we attach to each token on the board.
 * Other extensions can read `item.metadata["com.owlbear.tools/monster"]`
 * and get the source, CR, AC, HP, type, and size for the creature.
 */
const METADATA_KEY = 'com.owlbear.tools/monster';

// The five source books most people actually want.
const CORE_SOURCES = ['XMM', 'MM', 'MPMM', 'VGM', 'MTF'];

/*
 * Friendly labels for the source book chips in the toolbar.
 * `gen` controls the left-border color — orange for 2024 revision, blue for
 * 2014 core, purple for major supplements.  Unmarked sources get a neutral
 * border and are probably adventure-specific.
 */
const SOURCE_INFO = {
  XMM:  { label: 'Monster Manual (2024)',  gen: '2024' },
  MM:   { label: 'Monster Manual (2014)',  gen: '2014' },
  MPMM: { label: "Mordenkainen's Multiverse", gen: 'splat' },
  VGM:  { label: "Volo's Guide",           gen: 'splat' },
  MTF:  { label: "Mordenkainen's Tome",    gen: 'splat' },
  XPHB: { label: 'PHB (2024)',             gen: '2024' },
  XDMG: { label: 'DMG (2024)',             gen: '2024' },
  DMG:  { label: 'DMG (2014)',             gen: '2014' },
  PHB:  { label: 'PHB (2014)',             gen: '2014' },
  TCE:  { label: "Tasha's Cauldron",       gen: 'splat' },
  XGE:  { label: "Xanathar's Guide",       gen: 'splat' },
  BMT:  { label: 'Book of Many Things',    gen: 'splat' },
  FTD:  { label: "Fizban's Treasury",      gen: 'splat' },
  BGG:  { label: "Bigby's Giants",         gen: 'splat' },
  MOT:  { label: 'Mythic Odysseys',        gen: 'setting' },
  SCC:  { label: 'Strixhaven',             gen: 'setting' },
  ERLW: { label: 'Eberron',                gen: 'setting' },
  EGW:  { label: 'Wildemount',             gen: 'setting' },
  VRGR: { label: "Van Richten's",          gen: 'setting' },
  IDRotF: { label: 'Icewind Dale',         gen: 'setting' },
  SKT:  { label: "Storm King's Thunder",   gen: 'setting' },
  ToA:  { label: 'Tomb of Annihilation',   gen: 'setting' },
  BAM:  { label: "Boo's Astral Menagerie", gen: 'setting' },
  WBtW: { label: 'Wild Beyond the Witchlight', gen: 'setting' },
  FRAiF: { label: 'Feywild',              gen: 'setting' },
  PaBTSO: { label: 'Phandelver & Below',  gen: 'setting' },
  DSotDQ: { label: 'Dragonlance',         gen: 'setting' },
  CoS:  { label: 'Curse of Strahd',        gen: 'setting' },
  PotA: { label: 'Princes of the Apocalypse', gen: 'setting' },
  OotA: { label: 'Out of the Abyss',      gen: 'setting' },
  TftYP: { label: 'Yawning Portal',       gen: 'setting' },
  GoS:  { label: 'Ghosts of Saltmarsh',   gen: 'setting' },
  QftIS: { label: 'Infinite Staircase',   gen: 'setting' },
  VEoR: { label: 'Vecna: Eve of Ruin',    gen: 'setting' },
  MPP:  { label: "Morte's Planar Parade", gen: 'setting' },
  CM:   { label: 'Candlekeep Mysteries',  gen: 'setting' },
  JttRC: { label: 'Radiant Citadel',      gen: 'setting' },
  KftGV: { label: 'Golden Vault',         gen: 'setting' },
  WDH:  { label: 'Waterdeep: Heist',      gen: 'setting' },
  WDMM: { label: 'Waterdeep: Mad Mage',   gen: 'setting' },
  BGDIA: { label: 'Descent into Avernus', gen: 'setting' },
  HotDQ: { label: 'Hoard of the Dragon Queen', gen: 'setting' },
  RoT:  { label: 'Rise of Tiamat',        gen: 'setting' },
  MFF:  { label: 'Fantastic Adventures',  gen: 'setting' },
};

/*
 * Proportional sizes per creature size category, relative to one grid cell.
 * These are multiplied by the grid's DPI at drop time so tokens fit whatever
 * grid the scene uses — 50px, 100px, 200px, doesn't matter.
 * The constants represent fractions of a cell (0.9 = 90% of one cell).
 */
const SIZE_FACTOR = { T: 0.35, S: 0.55, M: 0.85, L: 1.85, H: 2.85, G: 3.85 };

/*
 * 5e.tools stores token images with Unicode characters decomposed to ASCII
 * (so "Mélisande" becomes "Melisande") and double quotes stripped.
 * This matches Parser.nameToTokenName() in their render.js — we had to dig
 * through the source to reverse-engineer it.
 */
function toAscii(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function tokenName(name) {
  return toAscii(name).replace(/"/g, '');
}

function getTokenUrl(mon) {
  return `${TOKEN_BASE}/${mon.source}/${encodeURIComponent(tokenName(mon.name))}.webp`;
}

/*
 * Token images come at different sizes depending on the source (280×280 for
 * legacy, 512×512 for 2024+).  Preload the image to get the real dimensions
 * so we can pass them to buildImage() — it needs them for aspect ratio.
 */
function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, type: img.type });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/*
 * The raw monster objects from 5e.tools are enormous — full statblocks with
 * actions, traits, spellcasting, the works.  We only need a handful of fields
 * for searching and token placement, so we strip everything else the moment
 * the JSON lands.  This cuts memory from ~5 MB to ~300 KB across all sources.
 */
function simplify(m) {
  let rawType = typeof m.type === 'string' ? m.type : m.type?.type;
  if (typeof rawType !== 'string') {
    rawType = rawType?.choose?.join('/') || '';
  }
  const rawCr = typeof m.cr === 'string' ? m.cr : m.cr?.cr || '\u2014';
  return {
    name: m.name,
    source: m.source,
    cr: rawCr,
    type: rawType.charAt(0).toUpperCase() + rawType.slice(1),
    size: m.size?.[0] || 'M',
    ac: m.ac?.[0] || null,
    hp: m.hp?.average || null,
  };
}

// ── OBR entry point ─────────────────────────────────────────────────────

OBR.onReady(async () => {
  try {
    await OBR.action.setIcon(new URL('icon.svg', window.location.href).href);
  } catch (e) { console.error('Icon set failed:', e); }

  if (!OBR.isAvailable) {
    document.getElementById('results').innerHTML =
      '<div class="placeholder">Not running inside Owlbear Rodeo</div>';
    return;
  }

  const searchEl = document.getElementById('search');
  const resultsEl = document.getElementById('results');
  const sourcesBar = document.getElementById('sources-bar');
  const toastEl = document.getElementById('toast');

  /*
   * Monster data accumulates as the user loads sources.
   * Each source can be toggled independently in case you only want, say,
   * the 2024 Monsters and nothing else.
   */
  const allMonsters = [];
  const loadedSources = new Map();
  const loadingSources = new Set();
  const activeSources = new Set();
  let fuse;  // Fuse index, rebuilt on every render

  // sessionStorage cache: survives popover close/reopen within the same tab,
  // so loading a source is instant the second time.
  const CACHE_KEY = 'ob5e';

  function saveCache() {
    try {
      const obj = {};
      for (const [code, m] of loadedSources) obj[code] = m;
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ sources: obj, active: [...activeSources] }));
    } catch {}  // quota exceeded — shrug
  }

  // Warm from sessionStorage.
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      for (const [code, m] of Object.entries(state.sources || {})) {
        loadedSources.set(code, m);
      }
      if (state.active) for (const c of state.active) activeSources.add(c);
    }
  } catch {}

  function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.style.background = isError ? 'var(--red)' : 'var(--green)';
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  /*
   * Rebuild the visible result list based on the search query.
   * Called on every keystroke and whenever sources are added/removed.
   */
  function render() {
    console.log(`[5etools] render: ${allMonsters.length} monsters in pool`);
    fuse = new Fuse(allMonsters, {
      keys: ['name'],
      threshold: 0.4,
      distance: 80,
      minMatchCharLength: 2,
    });

    const q = searchEl.value.trim();
    const list = q
      ? fuse.search(q).map(r => r.item)
      : [...allMonsters];

    console.log(`[5etools] render: query="${q}" → ${list.length} results`);

    if (allMonsters.length === 0) {
      resultsEl.innerHTML =
        '<div class="placeholder">Select a source book above to load monsters.<br>Data from 5e.tools GitHub mirrors.</div>';
      return;
    }

    if (list.length === 0) {
      resultsEl.innerHTML =
        `<div class="placeholder">No monsters matching &quot;${q}&quot;</div>`;
      return;
    }

    resultsEl.innerHTML = list.map(m => {
      return `<div class="monster-row" data-id="${m.name}|${m.source}">
        <img class="monster-token" alt="" crossorigin="anonymous" loading="lazy">
        <div class="monster-info">
          <div class="monster-name">${m.name}</div>
          <div class="monster-type">${m.type} \u00b7 ${m.size}</div>
        </div>
        <div class="monster-source">${m.source}</div>
        <div class="monster-cr">${m.cr}</div>
      </div>`;
    }).join('');

    resultsEl.querySelectorAll('.monster-row').forEach(row => {
      const img = row.querySelector('.monster-token');
      if (img) {
        const [name, source] = row.dataset.id.split('|');
        img.src = `${TOKEN_BASE}/${source}/${encodeURIComponent(tokenName(name))}.webp`;
        img.onerror = () => { img.style.display = 'none'; };
      }
      row.addEventListener('click', () => {
        const [name, source] = row.dataset.id.split('|');
        const mon = allMonsters.find(m => m.name === name && m.source === source);
        if (mon) dropToken(mon);
      });
    });
  }

  // ── Token dropping ──────────────────────────────────────────────────

  async function dropToken(monster) {
    const url = getTokenUrl(monster);
    console.log('dropToken:', monster.name, url);
    try {
      if (!(await OBR.scene.isReady())) {
        showToast('No scene is open', true);
        return;
      }

      const sceneDpi = await OBR.scene.grid.getDpi();

      /*
       * Place the token at the center of the user's current viewport
       * so it appears right where they're looking.
       *
       * IMPORTANT — coordinate API choice (why inverseTransformPoint
       * instead of getPosition):
       *
       *   OBR.viewport.getPosition() sounds like the obvious choice,
       *   but inside a popover iframe it returns a STALE position —
       *   typically the camera position from when the popover first
       *   opened.  If the user pans the canvas behind the popover,
       *   getPosition() still returns the old value.  Tokens always
       *   land at the same fixed world coordinate, appearing to drift
       *   further off-center the more the camera moves.
       *
       *   The root cause is that OBR's popover messageBus channels
       *   have different freshness guarantees.  getPosition() goes
       *   through a channel (OBR_VIEWPORT_GET_POSITION) that is
       *   snapshot-at-open in practice.  inverseTransformPoint on
       *   the other hand routes through OBR_VIEWPORT_INVERSE_TRANSFORM_POINT,
       *   which recomputes the world-space coordinate from the
       *   live screen-space center every call.
       *
       *   The correct spell: take the canvas center in screen space
       *   (viewportWidth/2, viewportHeight/2) and transform it to
       *   world coordinates.  This always reflects the current camera,
       *   even from a popover.
       */
      const [vpWidth, vpHeight] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
      const position = await OBR.viewport.inverseTransformPoint({
        x: vpWidth / 2,
        y: vpHeight / 2,
      });
      const px = (SIZE_FACTOR[monster.size] || SIZE_FACTOR.M) * sceneDpi;
      const src = await preloadImage(url);

      /*
       * ImageBuilder takes image details in the constructor:
       *   buildImage({ width, height, url, mime }, { dpi, offset })
       * The dpi must match the scene grid DPI — otherwise OBR internally
       * scales the image by sceneDpi / gridDpi, which shifts the offset
       * pivot and renders at the wrong size.
       */
      const item = buildImage(
        { width: src.width, height: src.height, url, mime: src.type || 'image/webp' },
        { dpi: sceneDpi, offset: { x: src.width / 2, y: src.height / 2 } },
      )
        .name(monster.name)
        .position(position)
        .scale({ x: px / src.width, y: px / src.height })
        .visible(true)
        .layer('CHARACTER')
        .metadata({
          [METADATA_KEY]: {
            name: monster.name,
            source: monster.source,
            cr: monster.cr,
            ac: monster.ac,
            hp: monster.hp,
            type: monster.type,
            size: monster.size,
          },
        })
        .build();

      console.log('built item:', item);
      await OBR.scene.items.addItems([item]);
      showToast(`\u2713 ${monster.name} placed on board`);
    } catch (err) {
      console.error('dropToken failed:', err);
      showToast('Failed to place token', true);
    }
  }

  // ── Source book chip builder ────────────────────────────────────────

  function addSourceChip(code, label, gen) {
    const btn = document.createElement('button');
    btn.className = `source-chip${gen ? ' gen-' + gen : ''}`;
    btn.dataset.code = code;
    btn.textContent = label;

    btn.addEventListener('click', async () => {
      if (loadingSources.has(code)) return;

      // Already fetched → just toggle visibility.
      if (loadedSources.has(code)) {
        if (activeSources.has(code)) {
          activeSources.delete(code);
          btn.classList.remove('active');
          // Walk backwards to avoid index shifting on splice.
          let i = allMonsters.length;
          while (i--) {
            if (allMonsters[i].source === code) allMonsters.splice(i, 1);
          }
        } else {
          activeSources.add(code);
          btn.classList.add('active');
          allMonsters.push(...loadedSources.get(code));
        }
        saveCache();
        render();
        return;
      }

      loadingSources.add(code);
      btn.classList.add('loading');
      btn.textContent = `${label}\u2026`;

      try {
        const file = `bestiary-${code.toLowerCase()}.json`;
        const resp = await fetch(`${BESTIARY_DIR}/${file}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const monsters = (data.monster || [])
          .filter(m => m.hasToken !== false)
          .map(simplify);

        console.log(`[5etools] ${label}: ${data.monster?.length || 0} raw → ${monsters.length} simplified`);

        loadedSources.set(code, monsters);
        btn.classList.remove('loading', 'loaded');
        btn.classList.add('loaded');

        activeSources.add(code);
        btn.classList.add('active');
        allMonsters.push(...monsters);
        saveCache();
        render();

        const count = monsters.length;
        showToast(`Loaded ${count} monster${count === 1 ? '' : 's'} from ${label}`);
      } catch (err) {
        console.error(err);
        btn.classList.remove('loading');
        btn.textContent = label;
        showToast(`Failed to load ${label}`, true);
      } finally {
        loadingSources.delete(code);
      }
    });

    return btn;
  }

  // ── Bootstrap ────────────────────────────────────────────────────────

  let sourceIndex;
  try {
    const resp = await fetch(`${BESTIARY_DIR}/index.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    sourceIndex = await resp.json();
  } catch (err) {
    console.error(err);
    resultsEl.innerHTML =
      '<div class="placeholder">Failed to reach 5e.tools data mirror.</div>';
    return;
  }

  // Core source books first, then alphabetical.
  const allCodes = Object.keys(sourceIndex).sort((a, b) => {
    const aC = CORE_SOURCES.includes(a);
    const bC = CORE_SOURCES.includes(b);
    if (aC && !bC) return -1;
    if (!aC && bC) return 1;
    return a.localeCompare(b);
  });

  const loadAllBtn = document.createElement('button');
  loadAllBtn.className = 'source-chip';
  loadAllBtn.textContent = '\u26A0\uFE0F All Core Books';

  loadAllBtn.addEventListener('click', async () => {
    if (loadAllBtn.classList.contains('loading')) return;
    loadAllBtn.classList.add('loading');
    loadAllBtn.textContent = 'Loading\u2026';

    for (const code of CORE_SOURCES) {
      if (loadedSources.has(code)) {
        if (!activeSources.has(code)) {
          activeSources.add(code);
          const chip = sourcesBar.querySelector(`[data-code="${code}"]`);
          if (chip) chip.classList.add('loaded', 'active');
          allMonsters.push(...loadedSources.get(code));
        }
        continue;
      }
      try {
        const file = `bestiary-${code.toLowerCase()}.json`;
        const resp = await fetch(`${BESTIARY_DIR}/${file}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        const monsters = (data.monster || [])
          .filter(m => m.hasToken !== false)
          .map(simplify);
        loadedSources.set(code, monsters);
        const chip = sourcesBar.querySelector(`[data-code="${code}"]`);
        if (chip) chip.classList.add('loaded', 'active');
        activeSources.add(code);
        allMonsters.push(...monsters);
      } catch (err) {
        console.error(err);
      }
    }
    saveCache();
    loadAllBtn.classList.remove('loading');
    loadAllBtn.textContent = '\u26A0\uFE0F All Core';
    render();
    showToast(`Loaded ${allMonsters.length} monsters total`);
  });

  sourcesBar.appendChild(loadAllBtn);

  const sep = document.createElement('span');
  sep.style.cssText =
    'color: var(--text-muted); font-size: 11px; align-self: center;';
  sep.textContent = '\u2502';
  sourcesBar.appendChild(sep);

  for (const code of allCodes) {
    const info = SOURCE_INFO[code];
    const label = info?.label || code;
    const gen = info?.gen || '';
    sourcesBar.appendChild(addSourceChip(code, label, gen));
  }

  // Restore chips and monster list from sessionStorage cache.
  for (const code of activeSources) {
    const chip = sourcesBar.querySelector(`[data-code="${code}"]`);
    if (chip && loadedSources.has(code)) {
      chip.classList.add('loaded', 'active');
      allMonsters.push(...loadedSources.get(code));
    }
  }
  render();

  // ── Debug: force-drop a token at (0,0) to verify coordinates ──────

  // Double-click the extension title to place a known token at origin.
  document.querySelector('.header h1').addEventListener('dblclick', async () => {
    try {
      const sceneDpi = await OBR.scene.grid.getDpi();
      const url = 'https://raw.githubusercontent.com/5etools-mirror-2/5etools-img/main/bestiary/tokens/MM/Goblin.webp';
      const src = await preloadImage(url);
      const px = SIZE_FACTOR.M * sceneDpi;
      const item = buildImage(
        { width: src.width, height: src.height, url, mime: 'image/webp' },
        { dpi: sceneDpi, offset: { x: src.width / 2, y: src.height / 2 } },
      )
        .name('TEST GOBLIN at (0,0)')
        .position({ x: 0, y: 0 })
        .scale({ x: px / src.width, y: px / src.height })
        .visible(true)
        .layer('CHARACTER')
        .build();
      await OBR.scene.items.addItems([item]);
      showToast('Test goblin at (0,0)');
    } catch (err) {
      console.error(err);
    }
  });

  // ── Expand / modal toggle ────────────────────────────────────────────

  const expandBtn = document.getElementById('expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', async () => {
      try {
        await OBR.modal.open({
          id: 'com.owlbear.tools/bestiary',
          url: '/',
          height: 840,
          width: 640,
        });
      } catch (err) {
        console.error('Failed to open modal:', err);
      }
    });
  }

  searchEl.addEventListener('input', render);
});
