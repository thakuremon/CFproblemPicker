const REQUEST_DELAY = 300; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let loadedFriends = [];

// Load handles from localStorage automatically when the page boots up
window.addEventListener('DOMContentLoaded', () => {
  const cachedFriends = localStorage.getItem('cf_saved_friends');
  const fileStatusDiv = document.getElementById('fileStatus');
  
  if (cachedFriends) {
    loadedFriends = JSON.parse(cachedFriends);
    fileStatusDiv.innerText = `✓ Loaded ${loadedFriends.length} handles from persistent storage.`;
    fileStatusDiv.style.color = '#28a745';
  }
});

// Watch for file upload changes, process text strings, and update localStorage cache
document.getElementById('fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  const fileStatusDiv = document.getElementById('fileStatus');
  
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    
    // Split by newlines, trim whitespace, and clean out empty elements
    loadedFriends = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    
    if (loadedFriends.length > 0) {
      localStorage.setItem('cf_saved_friends', JSON.stringify(loadedFriends));
      // Reset the user submission history cache since the friend group configuration changed
      localStorage.removeItem('cf_submission_history_cache');
      
      fileStatusDiv.innerText = `✓ Successfully saved ${loadedFriends.length} handles. Ready to use!`;
      fileStatusDiv.style.color = '#28a745';
    } else {
      fileStatusDiv.innerText = "Error: The uploaded file appears to be empty.";
      fileStatusDiv.style.color = '#dc3545';
    }
  };
  reader.readAsText(file);
});

document.getElementById('findBtn').addEventListener('click', async () => {
  const findBtn = document.getElementById('findBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  
  const tags = document.getElementById('tags').value.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
  const minRating = parseInt(document.getElementById('minRating').value) || 0;
  const maxRating = parseInt(document.getElementById('maxRating').value) || 5000;
  const count = parseInt(document.getElementById('count').value) || 5;

  if (loadedFriends.length === 0) {
    statusDiv.innerText = "Error: Please upload a text file containing friend handles first!";
    return;
  }

  findBtn.disabled = true;
  resultsDiv.innerHTML = '';
  
  try {
    let solvedSet = new Set();
    
    const cachedData = localStorage.getItem('cf_submission_history_cache');
    const cachedTime = localStorage.getItem('cf_submission_history_time');

    if (cachedData && cachedTime && (Date.now() - parseInt(cachedTime) < 3600000)) {
      statusDiv.innerText = "Loading cached friend problem histories...";
      solvedSet = new Set(JSON.parse(cachedData));
    } else {
      // Loop through all verified handles in our active file pool
      for (let i = 0; i < loadedFriends.length; i++) {
        statusDiv.innerText = `Syncing data [${i + 1}/${loadedFriends.length}]: ${loadedFriends[i]}`;
        try {
          const res = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(loadedFriends[i])}`);
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
      localStorage.setItem('cf_submission_history_cache', JSON.stringify(Array.from(solvedSet)));
      localStorage.setItem('cf_submission_history_time', Date.now().toString());
    }

    statusDiv.innerText = "Fetching standard problems...";
    const pRes = await fetch('https://codeforces.com/api/problemset.problems');
    const pData = await pRes.json();
    
    statusDiv.innerText = "Fetching Gym rosters...";
    const gymRes = await fetch('https://codeforces.com/api/contest.list?gym=true');
    const gymData = await gymRes.json();
    
    let allProblems = [];
    if (pData.status === 'OK') {
      allProblems = pData.result.problems.map(p => ({
        ...p, url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`, isGym: false
      }));
    }

    if (gymData.status === 'OK') {
      const recentGyms = gymData.result.slice(0, 15); 
      for (const gym of recentGyms) {
        try {
          const gStatus = await fetch(`https://codeforces.com/api/contest.status?contestId=${gym.id}&from=1&count=40`);
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
      statusDiv.innerText = "No matching problems found.";
    } else {
      statusDiv.innerText = `Success! Found ${shuffled.length} problem(s).`;
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
