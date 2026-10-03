// ================== CONFIG ==================
const REQUEST_DELAY = 2100;                 // Codeforces: ~1 request / 2 sec
const SOLVED_TTL    = 60 * 60 * 1000;       // friends' solved lists: 1 hour
const PROBLEMS_TTL  = 24 * 60 * 60 * 1000;  // problem list: 24 hours
const GYM_LIST_TTL  = 24 * 60 * 60 * 1000;  // gym contest list: 24 hours
const MAX_GYM_FETCHES = 12;                 // max new gym contests fetched per click

const CF_AVAILABLE_TAGS = [
  "2-sat", "binary search", "bitmasks", "brute force", "chinese remainder theorem",
  "combinatorics", "constructive algorithms", "data structures", "dfs and similar",
  "divide and conquer", "dp", "dsu", "expression parsing", "fft", "flows", "games",
  "geometry", "graph matchings", "graphs", "greedy", "hashing", "implementation",
  "interactive", "math", "matrices", "meet-in-the-middle", "number theory",
  "probabilities", "schedules", "shortest paths", "sortings",
  "string suffix structures", "strings", "ternary search", "trees", "two pointers"
];

const KEY_FRIENDS  = 'cf_saved_friends';
const KEY_PROBLEMS = 'cf_problems_v2';
const KEY_GYMLIST  = 'cf_gym_list_v2';
const keySolved = (h) => `cf_solved_v2_${h.toLowerCase()}`;
const keyGym    = (id) => `cf_gym_contest_v2_${id}`;

let loadedFriends = [];
let selectedTags = new Set();

// ================== HELPERS ==================
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    try { localStorage.removeItem(key); } catch (_) {}
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('localStorage write failed (quota?):', key, e);
    return false;
  }
}

function isFresh(entry, ttl) {
  return entry && typeof entry.t === 'number' && (Date.now() - entry.t) < ttl;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Global throttle + retry for every network call to Codeforces
let lastRequestAt = 0;
async function cfFetch(url, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = lastRequestAt + REQUEST_DELAY - Date.now();
    if (wait > 0) await delay(wait);
    lastRequestAt = Date.now();

    try {
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
      throw err; // real API error (bad handle, contest not found, ...)
    } catch (e) {
      if (e.cfComment && !e.isLimit) throw e;
      lastErr = e; // network error or rate limit -> retry
      await delay(1500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Request failed');
}

// ================== DATA LOADERS (all cached) ==================
async function getProblemset(statusDiv) {
  const cached = lsGet(KEY_PROBLEMS);
  if (isFresh(cached, PROBLEMS_TTL) && Array.isArray(cached.list)) return cached.list;

  statusDiv.innerText = 'Downloading problem set from Codeforces...';
  try {
    const data = await cfFetch('https://codeforces.com/api/problemset.problems');
    // compact format: [contestId, index, name, rating(0 = unrated), tags]
    const list = data.result.problems.map(p =>
      [p.contestId, p.index, p.name, p.rating || 0, p.tags || []]);
    lsSet(KEY_PROBLEMS, { t: Date.now(), list });
    return list;
  } catch (e) {
    if (cached && Array.isArray(cached.list)) return cached.list; // stale cache > nothing
    throw e;
  }
}

async function getSolvedForHandle(handle, statusDiv, forceRefresh) {
  const key = keySolved(handle);
  const cached = lsGet(key);
  if (!forceRefresh && isFresh(cached, SOLVED_TTL) && Array.isArray(cached.ids)) {
    return new Set(cached.ids);
  }

  statusDiv.innerText = `Fetching submissions: ${handle}...`;
  try {
    const data = await cfFetch(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}`);
    const solved = new Set();
    data.result.forEach(sub => {
      if (sub.verdict === 'OK' && sub.problem && sub.problem.contestId) {
        solved.add(`${sub.problem.contestId}-${sub.problem.index}`); // includes gym
      }
    });
    lsSet(key, { t: Date.now(), ids: Array.from(solved) });
    return solved;
  } catch (e) {
    console.error(`Failed to fetch ${handle}:`, e);
    if (cached && Array.isArray(cached.ids)) return new Set(cached.ids); // use stale
    throw e;
  }
}

async function getGymContestList(statusDiv) {
  const cached = lsGet(KEY_GYMLIST);
  if (isFresh(cached, GYM_LIST_TTL) && Array.isArray(cached.list)) return cached.list;

  statusDiv.innerText = 'Downloading gym contest list...';
  try {
    const data = await cfFetch('https://codeforces.com/api/contest.list?gym=true');
    const list = data.result
      .filter(c => c.phase === 'FINISHED')
      .map(c => [c.id, c.name]);
    lsSet(KEY_GYMLIST, { t: Date.now(), list });
    return list;
  } catch (e) {
    if (cached && Array.isArray(cached.list)) return cached.list;
    throw e;
  }
}

// returns { cached: bool, problems: [[index, name], ...] | null }
async function getGymContestProblems(contestId, statusDiv) {
  const key = keyGym(contestId);
  const cached = lsGet(key);
  if (cached) return { fromCache: true, problems: cached.ok ? cached.problems : null };

  statusDiv.innerText = `Loading gym contest ${contestId}...`;
  try {
    const data = await cfFetch(
      `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`);
    const problems = (data.result.problems || []).map(p => [p.index, p.name]);
    lsSet(key, { ok: true, problems });
    return { fromCache: false, problems };
  } catch (e) {
    // Permanent API error (private / not found) -> remember so we skip it next time
    if (e.cfComment && !e.isLimit) lsSet(key, { ok: false });
    return { fromCache: false, problems: null };
  }
}

// Collects unsolved gym problems until we have `need` (or hit the fetch limit)
async function buildGymPool(need, solvedSet, statusDiv) {
  const pool = [];
  if (need <= 0) return pool;

  const contests = shuffle([...(await getGymContestList(statusDiv))]);
  let networkFetches = 0;

  for (const [contestId, contestName] of contests) {
    if (pool.length >= need) break;
    if (networkFetches >= MAX_GYM_FETCHES && !lsGet(keyGym(contestId))) continue;

    const { fromCache, problems } = await getGymContestProblems(contestId, statusDiv);
    if (!fromCache) networkFetches++;
    if (!problems) continue;

    const unsolved = problems.filter(([idx]) => !solvedSet.has(`${contestId}-${idx}`));
    if (unsolved.length === 0) continue;

    // one random problem per contest for variety
    const [index, name] = unsolved[Math.floor(Math.random() * unsolved.length)];
    pool.push({
      contestId, index, name, rating: 0, tags: [], isGym: true, contestName,
      url: `https://codeforces.com/gym/${contestId}/problem/${index}`
    });
  }
  return pool;
}

// ================== UI SETUP ==================
window.addEventListener('DOMContentLoaded', () => {
  const tagsContainer = document.getElementById('tagsContainer');
  const fileStatusDiv = document.getElementById('fileStatus');

  CF_AVAILABLE_TAGS.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerText = tag;
    chip.addEventListener('click', () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        chip.classList.remove('selected');
      } else {
        selectedTags.add(tag);
        chip.classList.add('selected');
      }
    });
    tagsContainer.appendChild(chip);
  });

  const cachedFriends = lsGet(KEY_FRIENDS);
  if (Array.isArray(cachedFriends)) {
    loadedFriends = cachedFriends;
    fileStatusDiv.innerText = `✓ Loaded ${loadedFriends.length} handle(s) from local cache.`;
    fileStatusDiv.style.color = '#28a745';
  }

  // Upload handle list
  document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const seen = new Set();
      loadedFriends = e.target.result
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => {
          if (!l || seen.has(l.toLowerCase())) return false;
          seen.add(l.toLowerCase());
          return true;
        });

      if (loadedFriends.length > 0) {
        lsSet(KEY_FRIENDS, loadedFriends);
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
    clearBtn.addEventListener('click', () => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('cf_') && k !== KEY_FRIENDS)
        .forEach(k => localStorage.removeItem(k));
      document.getElementById('status').innerText = 'Cache cleared (handle list kept).';
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

    // dedupe handles case-insensitively
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
      // STEP 1: combined solved set (standard + gym) from all handles
      const solvedSet = new Set();
      const failedHandles = [];
      for (const handle of activeHandles) {
        try {
          const s = await getSolvedForHandle(handle, statusDiv, false);
          s.forEach(id => solvedSet.add(id));
        } catch (e) {
          failedHandles.push(handle);
        }
      }

      // STEP 2: problem set (cached)
      const problemList = await getProblemset(statusDiv);

      // STEP 3: standard pool (filtered)
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
          if (ratingFilterActive) continue; // unrated only when no rating filter
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
        // if standard pool is short, ask for extra gym problems to compensate
        const gymNeed = gymTarget + Math.max(0, standardTarget - standardPool.length);

        let gymPool = [];
        if (selectedTags.size > 0) {
          gymNote = ' (gym problems have no tags, so none were included)';
        } else {
          try {
            gymPool = await buildGymPool(gymNeed, solvedSet, statusDiv);
          } catch (e) {
            gymNote = ' (could not load gym problems: ' + e.message + ')';
          }
        }

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
      if (selectedProblems.length === 0) {
        statusDiv.innerText = 'No matching problems found.';
      } else {
        const gymCount = selectedProblems.filter(p => p.isGym).length;
        statusDiv.innerText =
          `Selected ${selectedProblems.length} problem(s) (${gymCount} gym).${gymNote}`;
      }
      if (failedHandles.length) {
        statusDiv.innerText += ` ⚠ Could not load: ${failedHandles.join(', ')}`;
      }

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
