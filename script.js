/*
 *   Copyright (c) 2026 Emon Thakur
 *   All rights reserved.
 */
const REQUEST_DELAY = 300; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

document.getElementById('findBtn').addEventListener('click', async () => {
  const findBtn = document.getElementById('findBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  
  const handle = document.getElementById('handle').value.trim();
  const tags = document.getElementById('tags').value.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
  const minRating = parseInt(document.getElementById('minRating').value) || 0;
  const maxRating = parseInt(document.getElementById('maxRating').value) || 5000;
  const count = parseInt(document.getElementById('count').value) || 5;

  if (!handle) {
    statusDiv.innerText = "Please enter your Codeforces handle!";
    return;
  }

  findBtn.disabled = true;
  resultsDiv.innerHTML = '';
  
  try {
    // Step 1: Fetch friends list via public profile page parsing using an open proxy bypass
    statusDiv.innerText = "Fetching your friends list...";
    const friends = await fetchFriendsList(handle);
    
    if (friends.length === 0) {
      statusDiv.innerText = "No public friends found or handle is incorrect.";
      findBtn.disabled = false;
      return;
    }

    // Check local storage cache first to save execution time
    const cacheKey = `cf_cache_${handle}`;
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheKey + '_time');
    let solvedSet = new Set();

    if (cachedData && cachedTime && (Date.now() - cachedTime < 3600000)) {
      statusDiv.innerText = "Loading cached friend histories...";
      solvedSet = new Set(JSON.parse(cachedData));
    } else {
      // Step 2: Query API history strings per unique friend
      for (let i = 0; i < friends.length; i++) {
        statusDiv.innerText = `Syncing friend data [${i + 1}/${friends.length}]: ${friends[i]}`;
        try {
          const res = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(friends[i])}`);
          const data = await res.json();
          if (data.status === 'OK') {
            data.result.forEach(sub => {
              if (sub.verdict === 'OK') {
                solvedSet.add(sub.problem.contestId + sub.problem.index);
              }
            });
          }
        } catch (e) { console.error(e); }
        await delay(REQUEST_DELAY);
      }
      // Save data back to localStorage standard cache
      localStorage.setItem(cacheKey, JSON.stringify(Array.from(solvedSet)));
      localStorage.setItem(cacheKey + '_time', Date.now().toString());
    }

    // Step 3: Fetch standard problems
    statusDiv.innerText = "Fetching problem matrices...";
    const pRes = await fetch('https://codeforces.com/api/problemset.problems');
    const pData = await pRes.json();
    
    // Fetch structural Gym parameters also
    statusDiv.innerText = "Fetching Gym rosters...";
    const gymRes = await fetch('https://codeforces.com/api/contest.list?gym=true');
    const gymData = await gymRes.json();
    
    let allProblems = [];
    if (pData.status === 'OK') {
      allProblems = pData.result.problems.map(p => ({
        ...p, url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`, isGym: false
      }));
    }

    // Add recent Gym index variations 
    if (gymData.status === 'OK') {
      const recentGyms = gymData.result.slice(0, 20); // Kept lower on web to prevent UI locking
      for (const gym of recentGyms) {
        try {
          const gStatus = await fetch(`https://codeforces.com/api/contest.status?contestId=${gym.id}&from=1&count=50`);
          const gData = await gStatus.json();
          if (gData.status === 'OK') {
            const seen = new Set();
            gData.result.forEach(sub => {
              const key = sub.problem.contestId + sub.problem.index;
              if (!seen.has(key)) {
                seen.add(key);
                allProblems.push({
                  ...sub.problem,
                  url: `https://codeforces.com/gym/${sub.problem.contestId}/problem/${sub.problem.index}`,
                  isGym: true
                });
              }
            });
          }
        } catch (e) {}
      }
    }

    // Step 4: Run target filter evaluations
    statusDiv.innerText = "Filtering results...";
    const filtered = allProblems.filter(p => {
      const uniqueKey = p.contestId + p.index;
      if (solvedSet.has(uniqueKey)) return false;
      
      if (p.rating !== undefined) {
        if (p.rating < minRating || p.rating > maxRating) return false;
      } else if (minRating > 0 && !p.isGym) {
        return false;
      }

      if (tags.length > 0) {
        if (!p.tags) return false;
        const pTags = p.tags.map(t => t.toLowerCase());
        if (!tags.every(t => pTags.includes(t))) return false;
      }
      return true;
    });

    const shuffled = filtered.sort(() => 0.5 - Math.random()).slice(0, count);

    if (shuffled.length === 0) {
      statusDiv.innerText = "No matches found.";
    } else {
      statusDiv.innerText = `Success! Found ${shuffled.length} problems.`;
      shuffled.forEach(p => {
        const a = document.createElement('a');
        a.href = p.url;
        a.target = '_blank';
        a.className = 'problem-link';
        a.innerText = `[${p.rating || 'Gym'}] ${p.name}`;
        resultsDiv.appendChild(a);
      });
    }

  } catch (error) {
    statusDiv.innerText = "Error: " + error.message;
  } finally {
    findBtn.disabled = false;
  }
});

// Web version targets the public friend list page through a free proxy service to avoid local client CORS blocking rules
async function fetchFriendsList(handle) {
  const proxyUrl = 'https://api.allorigins.win/get?url=';
  const targetUrl = encodeURIComponent(`https://codeforces.com/friends/of/${handle}`);
  
  const response = await fetch(`${proxyUrl}${targetUrl}`);
  const data = await response.json();
  const html = data.contents;
  
  const handleRegex = /\/profile\/([a-zA-Z0-9_\-]+)"/g;
  const friends = new Set();
  let match;
  
  while ((match = handleRegex.exec(html)) !== null) {
    if (match[1].toLowerCase() !== handle.toLowerCase()) {
      friends.add(match[1]);
    }
  }
  return Array.from(friends);
}
