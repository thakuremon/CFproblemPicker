// ================== CONFIG ==================
const REQUEST_DELAY   = 2100;                  // CF limit: ~1 request / 2 sec
const SOLVED_TTL      = 12 * 60 * 60 * 1000;   // friends' solved lists: 12h
const PROBLEMS_TTL    = 24 * 60 * 60 * 1000;   // problem list: 24h
const GYM_LIST_TTL    = 24 * 60 * 60 * 1000;   // gym contest list: 24h
const MAX_GYM_FETCHES = 40;                    // max NEW gym contests probed per click
const GYM_PER_CONTEST = 3;                     // max problems taken from one gym contest

const CF_AVAILABLE_TAGS = [
  "2-sat", "binary search", "bitmasks", "brute force", "chinese remainder theorem",
  "combinatorics", "constructive algorithms", "data structures", "dfs and similar",
  "divide and conquer", "dp", "dsu", "expression parsing", "fft", "flows", "games",
  "geometry", "graph matchings", "graphs", "greedy", "hashing", "implementation",
  "interactive", "math", "matrices", "meet-in-the-middle", "number theory",
  "probabilities", "schedules", "shortest paths", "sortings",
  "string suffix structures", "strings", "ternary search", "trees", "two pointers"
];

const KEY_FRIENDS = 'cf_saved_friends';   // localStorage (tiny)
const LS_API_KEY  = 'cf_api_key';
const LS_API_SEC  = 'cf_api_secret';

let loadedFriends = [];
let selectedTags = new Set();

// ================== STORAGE (IndexedDB + in-memory fallback) ==================
const DB_NAME = 'cf_picker_db', STORE = 'kv';
const mem = new Map();
let dbPromise = null;
let persistFailed = false;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const store = {
  async get(key) {
    if (mem.has(key)) return mem.get(key);
    try {
      const db = await openDB();
      const val = await new Promise((resolve, reject) => {
        const q = db.transaction(STORE).objectStore(STORE).get(key);
        q.onsuccess = () => resolve(q.result ?? null);
        q.onerror = () => reject(q.error);
      });
      if (val !== null) mem.set(key, val);
      return val;
    } catch (e) {
      console.warn('IndexedDB read failed:', e);
      return null;
    }
  },
  async set(key, val) {
    mem.set(key, val);
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) {
      persistFailed = true;
      console.warn('IndexedDB write failed (cache will last only for this session):', e);
    }
  },
  async clear() {
    mem.clear();
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { console.warn('IndexedDB clear failed:', e); }
  }
};

const isFresh = (entry, ttl) => entry && typeof entry.t === 'number' && (Date.now() - entry.t) < ttl;

// ================== HELPERS ==================
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- API signing (needed for gym contest.standings) ----
async function sha512Hex(str) {
  const buf = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedUrl(method, params, creds) {
  const p = { ...params, apiKey: creds.key, time: Math.floor(Date.now() / 1000) };
  const keys = Object.keys(p).sort();
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map(b => b.toString(16).padStart(2, '0')).join('');           // 6 hex chars
  const plainQs = keys.map(k => `${k}=${p[k]}`).join('&');
  const sig = rand + await sha512Hex(`${rand}/${method}?${plainQs}#${creds.secret}`);
  const qs = keys.map(k => `${k}=${encodeURIComponent(p[k])}`).join('&');
  return `https://codeforces.com/api/${method}?${qs}&apiSig=${sig}`;
}

function getCreds() {
  const key = (document.getElementById('apiKeyInput')?.value || '').trim();
  const secret = (document.getElementById('apiSecretInput')?.value || '').trim();
  return key && secret ? { key, secret } : null;
}

// ---- Throttled fetch with retry. `urlOrFn` may be a string or an async fn returning a URL ----
let lastRequestAt = 0;
async function cfFetch(urlOrFn, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = lastRequestAt + REQUEST_DELAY - Date.now();
    if (wait > 0) await delay(wait);
    lastRequestAt = Date.now();

    try {
      const url = typeof urlOrFn === 'function' ? await urlOrFn() : urlOrFn;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'OK') return data;

      const comment = data.comment || 'Unknown API error';
      const err = new Error(comment);
      err.cfComment = comment;
      if (/limit exceeded/i.test(comment)) {
        err.isLimit = true;
        lastErr = err;
        await delay(2500 * (attempt + 1));
        continue;
      }
      throw err;
    } catch (e) {
      if (e.cfComment && !e.isLimit) throw e;
      lastErr = e;
      await delay(1500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Request failed');
}

// ================== DATA LOADERS (cached) ==================
async function getProblemset(statusDiv) {
  const cached = await store.get('problems');
  if (isFresh(cached, PROBLEMS_TTL) && Array.isArray(cached.list)) return cached.list;

  statusDiv.innerText = 'Downloading problem set from Codeforces...';
  try {
    const data = await cfFetch('https://codeforces.com/api/problemset.problems');
    // compact: [contestId, index, name, rating (0 = unrated), tags]
    const list = data.result.problems.map(p =>
      [p.contestId, p.index, p.name, p.rating || 0, p.tags || []]);
    await store.set('problems', { t: Date.now(), list });
    return list;
  } catch (e) {
    if (cached && Array.isArray(cached.list)) return cached.list;
    throw e;
  }
}

async function getSolvedForHandle(handle, statusDiv) {
  const key = `solved:${handle.toLowerCase()}`;
  const cached = await store.get(key);
  if (isFresh(cached, SOLVED_TTL) && Array.isArray(cached.ids)) {
    return { set: new Set(cached.ids), fromCache: true };
  }

  statusDiv.innerText = `Fetching submissions: ${handle}...`;
  try {
    const data = await cfFetch(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}`);
    const solved = new Set();
    data.result.forEach(sub => {
      if (sub.verdict === 'OK' && sub.problem && sub.problem.contestId) {
        solved.add(`${sub.problem.contestId}-${sub.problem.index}`);   // includes gym
      }
    });
    await store.set(key, { t: Date.now(), ids: Array.from(solved) });
    return { set: solved, fromCache: false };
  } catch (e) {
    console.error(`Failed to fetch ${handle}:`, e);
    if (cached && Array.isArray(cached.ids)) return { set: new Set(cached.ids), fromCache: true };
    throw e;
  }
}

async function getGymContestList(statusDiv) {
  const cached = await store.get('gymlist');
  if (isFresh(cached, GYM_LIST_TTL) && Array.isArray(cached.list)) return cached.list;

  statusDiv.innerText = 'Downloading gym contest list...';
  try {
    const data = await cfFetch('https://codeforces.com/api/contest.list?gym=true');
    const list = data.result.filter(c => c.phase === 'FINISHED').map(c => [c.id, c.name]);
    await store.set('gymlist', { t: Date.now(), list });
    return list;
  } catch (e) {
    if (cached && Array.isArray(cached.list)) return cached.list;
    throw e;
  }
}

// Gym problems are only available through an AUTHENTICATED contest.standings call.
async function getGymContestProblems(contestId, creds) {
  const key = `gym:${contestId}`;
  const cached = await store.get(key);
  if (cached) return { fromCache: true, problems: cached.ok ? cached.problems : null };

  try {
    const data = await cfFetch(() => signedUrl(
      'contest.standings', { contestId, from: 1, count: 1 }, creds));
    const problems = (data.result.problems || []).map(p => [p.index, p.name]);
    await store.set(key, { ok: true, problems });
    return { fromCache: false, problems };
  } catch (e) {
    const c = e.cfComment || '';
    // Credential / signature problem -> stop everything, do NOT cache
    if (/authenticat|apiKey|apiSig|signature|api key|time:/i.test(c)) {
      const err = new Error(c);
      err.isAuth = true;
      throw err;
    }
    // Contest genuinely not viewable -> remember so we skip it next time
    if (e.cfComment && !e.isLimit) await store.set(key, { ok: false, why: c });
    return { fromCache: false, problems: null };
  }
}

async function buildGymPool(need, solvedSet, creds, statusDiv) {
  const pool = [];
  let probed = 0, inaccessible = 0;
  if (need <= 0) return { pool, probed, inaccessible };

  const contests = shuffle([...(await getGymContestList(statusDiv))]);

  for (const [contestId, contestName] of contests) {
    if (pool.length >= need) break;

    const isCached = mem.has(`gym:${contestId}`) || await store.get(`gym:${contestId}`);
    if (!isCached && probed >= MAX_GYM_FETCHES) continue;

    if (!isCached) {
      probed++;
      statusDiv.innerText =
        `Loading gym contests... probed ${probed}/${MAX_GYM_FETCHES}, found ${pool.length}/${need} problems`;
    }

    const { problems } = await getGymContestProblems(contestId, creds);
    if (!problems) { inaccessible++; continue; }

    const unsolved = shuffle(problems.filter(([idx]) => !solvedSet.has(`${contestId}-${idx}`)));
    for (const [index, name] of unsolved.slice(0, GYM_PER_CONTEST)) {
      pool.push({
        contestId, index, name, rating: 0, tags: [], isGym: true, contestName,
        url: `https://codeforces.com/gym/${contestId}/problem/${index}`
      });
    }
  }
  return { pool, probed, inaccessible };
}

// ================== UI SETUP ==================
function ensureApiInputs() {
  let keyEl = document.getElementById('apiKeyInput');
  let secEl = document.getElementById('apiSecretInput');
  if (!keyEl || !secEl) {
    const wrap = document.createElement('div');
    wrap.style.margin = '8px 0';
    const label = document.createElement('div');
    label.style.fontSize = '13px';
    label.style.marginBottom = '4px';
    label.innerText = 'Codeforces API key & secret (required only for gym problems — get them at codeforces.com/settings/api):';
    keyEl = document.createElement('input');
    keyEl.id = 'apiKeyInput'; keyEl.type = 'text'; keyEl.placeholder = 'API key';
    secEl = document.createElement('input');
    secEl.id = 'apiSecretInput'; secEl.type = 'password'; secEl.placeholder = 'API secret';
    wrap.append(label, keyEl, ' ', secEl);
    const btn = document.getElementById('findBtn');
    btn.parentNode.insertBefore(wrap, btn);
  }
  keyEl.value = localStorage.getItem(LS_API_KEY) || '';
  secEl.value = localStorage.getItem(LS_API_SEC) || '';
  keyEl.addEventListener('input', () => localStorage.setItem(LS_API_KEY, keyEl.value.trim()));
  secEl.addEventListener('input', () => localStorage.setItem(LS_API_SEC, secEl.value.trim()));
}

window.addEventListener('DOMContentLoaded', () => {
  // Free up localStorage space used by older versions of this script
  Object.keys(localStorage)
    .filter(k => /^cf_(user_solved_|solved_v2_|problems_v2|gym_)/.test(k))
    .forEach(k => localStorage.removeItem(k));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  const tagsContainer = document.getElementById('tagsContainer');
  const fileStatusDiv = document.getElementById('fileStatus');

  CF_AVAILABLE_TAGS.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerText = tag;
    chip.addEventListener('click', () => {
      if (selectedTags.has(tag)) { selectedTags.delete(tag); chip.classList.remove('selected'); }
      else { selectedTags.add(tag); chip.classList.add('selected'); }
    });
    tagsContainer.appendChild(chip);
  });

  ensureApiInputs();

  try {
    const cachedFriends = JSON.parse(localStorage.getItem(KEY_FRIENDS) || 'null');
    if (Array.isArray(cachedFriends)) {
      loadedFriends = cachedFriends;
      fileStatusDiv.innerText = `✓ Loaded ${loadedFriends.length} handle(s) from local cache.`;
      fileStatusDiv.style.color = '#28a745';
    }
  } catch (e) { localStorage.removeItem(KEY_FRIENDS); }

  document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const seen = new Set();
      loadedFriends = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => {
        if (!l || seen.has(l.toLowerCase())) return false;
        seen.add(l.toLowerCase());
        return true;
      });
      if (loadedFriends.length > 0) {
        localStorage.setItem(KEY_FRIENDS, JSON.stringify(loadedFriends));
        fileStatusDiv.innerText = `✓ Saved ${loadedFriends.length} handle(s) locally.`;
        fileStatusDiv.style.color = '#28a745';
      } else {
        fileStatusDiv.innerText = 'Error: Uploaded file is empty.';
        fileStatusDiv.style.color = '#dc3545';
      }
    };
    reader.readAsText(file);
  });

  // Optional: add <button id="clearCacheBtn">Clear cache</button> to your HTML
  const clearBtn = document.getElementById('clearCacheBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await store.clear();
      document.getElementById('status').innerText = 'Cache cleared (handle list & API key kept).';
    });
  }

  // ================== MAIN ACTION ==================
  document.getElementById('findBtn').addEventListener('click', async () => {
    const findBtn = document.getElementById('findBtn');
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');

    const singleHandle = document.getElementById('singleHandleInput').value.trim();
    const includeGym = document.getElementById('includeGymCheckbox').checked;
    const minRaw = document.getElementById('minRating').value.trim();
    const maxRaw = document.getElementById('maxRating').value.trim();
    const minRating = parseInt(minRaw) || 0;
    const maxRating = parseInt(maxRaw) || 5000;
    const count = parseInt(document.getElementById('count').value) || 5;
    const ratingFilterActive = minRaw !== '' || maxRaw !== '';

    const seen = new Set();
    const activeHandles = [...loadedFriends, ...(singleHandle ? [singleHandle] : [])]
      .filter(h => {
        const k = h.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    if (activeHandles.length === 0) {
      statusDiv.innerText = 'Error: Please enter a handle or upload a handles file.';
      statusDiv.style.color = '#dc3545';
      return;
    }

    findBtn.disabled = true;
    resultsDiv.innerHTML = '';
    statusDiv.style.color = '#333';

    try {
      // STEP 1: combined solved set (standard + gym)
      const solvedSet = new Set();
      const failedHandles = [];
      let fromCacheCount = 0, fetchedCount = 0;
      for (const handle of activeHandles) {
        try {
          const { set, fromCache } = await getSolvedForHandle(handle, statusDiv);
          set.forEach(id => solvedSet.add(id));
          fromCache ? fromCacheCount++ : fetchedCount++;
        } catch (e) {
          failedHandles.push(handle);
        }
      }

      // STEP 2: problem set
      const problemList = await getProblemset(statusDiv);

      // STEP 3: standard pool
      const standardPool = [];
      for (const [contestId, index, name, rating, tags] of problemList) {
        if (solvedSet.has(`${contestId}-${index}`)) continue;

        if (selectedTags.size > 0) {
          const pTags = tags.map(t => t.toLowerCase());
          let ok = true;
          for (const t of selectedTags) if (!pTags.includes(t)) { ok = false; break; }
          if (!ok) continue;
        }

        if (rating === 0) {
          if (ratingFilterActive) continue;
        } else if (rating < minRating || rating > maxRating) {
          continue;
        }

        standardPool.push({
          contestId, index, name, rating, tags, isGym: false,
          url: `https://codeforces.com/problemset/problem/${contestId}/${index}`
        });
      }
      shuffle(standardPool);

      // STEP 4: choose problems
      let selectedProblems = [];
      let gymNote = '';

      if (includeGym) {
        const gymTarget = Math.ceil(count / 2);
        const standardTarget = count - gymTarget;
        const gymNeed = gymTarget + Math.max(0, standardTarget - standardPool.length);
        const creds = getCreds();
        let gymPool = [];

        if (selectedTags.size > 0) {
          gymNote = ' ⚠ Gym skipped: gym problems have no tags.';
        } else if (!creds) {
          gymNote = ' ⚠ Gym skipped: enter your Codeforces API key & secret (gym data requires authentication).';
        } else if (!(window.crypto && crypto.subtle)) {
          gymNote = ' ⚠ Gym skipped: crypto.subtle needs https:// or localhost (or a file:// page).';
        } else {
          try {
            const r = await buildGymPool(gymNeed, solvedSet, creds, statusDiv);
            gymPool = r.pool;
            if (gymPool.length < gymTarget) {
              gymNote = ` ⚠ Only ${gymPool.length} gym problem(s) found (${r.inaccessible} contests inaccessible). Click again to probe more contests.`;
            }
          } catch (e) {
            gymNote = ' ⚠ Gym failed: ' + e.message;
          }
        }

        shuffle(gymPool);
        const pickedGym = gymPool.slice(0, gymTarget);
        const pickedStandard = standardPool.slice(0, standardTarget);
        selectedProblems = [...pickedGym, ...pickedStandard];

        if (selectedProblems.length < count) {
          const extra = [...gymPool.slice(gymTarget), ...standardPool.slice(standardTarget)];
          selectedProblems.push(...extra.slice(0, count - selectedProblems.length));
        }
      } else {
        selectedProblems = standardPool.slice(0, count);
      }

      shuffle(selectedProblems);

      // STEP 5: render
      const gymCount = selectedProblems.filter(p => p.isGym).length;
      let msg = selectedProblems.length === 0
        ? 'No matching problems found.'
        : `Selected ${selectedProblems.length} problem(s) (${gymCount} gym).`;
      msg += ` [solved lists: ${fromCacheCount} cached, ${fetchedCount} fetched]`;
      msg += gymNote;
      if (failedHandles.length) msg += ` ⚠ Could not load: ${failedHandles.join(', ')}`;
      if (persistFailed) msg += ' ⚠ Browser blocked persistent cache (IndexedDB) — cache lasts only this session.';
      statusDiv.innerText = msg;

      selectedProblems.forEach(p => {
        const problemId = `${p.contestId}${p.index}`;

        const card = document.createElement('div');
        card.className = 'problem-card';

        const link = document.createElement('a');
        link.href = p.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'problem-link';
        const label = p.isGym ? 'Gym' : (p.rating || 'Unrated');
        link.innerText = `[${label}] ${problemId} - ${p.name}` +
                         (p.isGym && p.contestName ? ` (${p.contestName})` : '');

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerText = 'Copy ID';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(problemId).then(() => {
            copyBtn.innerText = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.innerText = 'Copy ID';
              copyBtn.classList.remove('copied');
            }, 1500);
          }).catch(err => console.error('Copy failed:', err));
        });

        card.appendChild(link);
        card.appendChild(copyBtn);
        resultsDiv.appendChild(card);
      });

    } catch (error) {
      statusDiv.innerText = 'Error: ' + error.message;
      statusDiv.style.color = '#dc3545';
    } finally {
      findBtn.disabled = false;
    }
  });
});
