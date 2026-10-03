const REQUEST_DELAY = 300; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Caching Durations
const SUBMISSION_CACHE_DURATION = 14 * 24 * 60 * 60 * 1000; // 14 Days

const CF_AVAILABLE_TAGS = [
  "2-sat", "binary search", "bitmasks", "brute force", "busyness", 
  "chinese remainder theorem", "combinatorics", "constructive algorithms", 
  "data structures", "dfs and similar", "divide and conquer", "dp", 
  "dsu", "expression parsing", "fft", "flows", "games", "geometry", 
  "graph matchings", "graphs", "greedy", "hashing", "implementation", 
  "interactive", "math", "matrices", "meet-in-the-middle", "number theory", 
  "probabilities", "schedules", "shortest paths", "sortings", "string suffix structures", 
  "strings", "ternary search", "trees", "two pointers"
];

let loadedFriends = [];
let selectedTags = new Set();

// Populate interactive tag selection chips and load cached handles on startup
window.addEventListener('DOMContentLoaded', () => {
  const tagsContainer = document.getElementById('tagsContainer');
  
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

  // Load cached handle list
  const cachedFriends = localStorage.getItem('cf_saved_friends');
  const fileStatusDiv = document.getElementById('fileStatus');
  if (cachedFriends) {
    try {
      loadedFriends = JSON.parse(cachedFriends);
      fileStatusDiv.innerText = `✓ Loaded ${loadedFriends.length} handle(s) from local cache.`;
      fileStatusDiv.style.color = '#28a745';
    } catch (e) {
      localStorage.removeItem('cf_saved_friends');
    }
  }
});

// Watch for file upload changes and save handles locally
document.getElementById('fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  const fileStatusDiv = document.getElementById('fileStatus');
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    loadedFriends = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    
    if (loadedFriends.length > 0) {
      localStorage.setItem('cf_saved_friends', JSON.stringify(loadedFriends));
      // Reset submission cache when handles change
      localStorage.removeItem('cf_submission_history_cache');
      fileStatusDiv.innerText = `✓ Saved ${loadedFriends.length} handle(s) locally.`;
      fileStatusDiv.style.color = '#28a745';
    } else {
      fileStatusDiv.innerText = "Error: Uploaded file is empty.";
      fileStatusDiv.style.color = '#dc3545';
    }
  };
  reader.readAsText(file);
});

// Main execution logic
document.getElementById('findBtn').addEventListener('click', async () => {
  const findBtn = document.getElementById('findBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  
  const singleHandle = document.getElementById('singleHandleInput').value.trim();
  const includeGym = document.getElementById('includeGymCheckbox').checked;
  const minRating = parseInt(document.getElementById('minRating').value) || 0;
  const maxRating = parseInt(document.getElementById('maxRating').value) || 5000;
  const count = parseInt(document.getElementById('count').value) || 5;

  // Combine single handle input with file handles and remove duplicates
  let activeHandles = [...loadedFriends];
  if (singleHandle) {
    activeHandles.push(singleHandle);
  }
  activeHandles = [...new Set(activeHandles)];

  if (activeHandles.length === 0) {
    statusDiv.innerText = "Error: Please enter a single handle OR upload a handles file.";
    statusDiv.style.color = '#dc3545';
    return;
  }

  findBtn.disabled = true;
  resultsDiv.innerHTML = '';
  statusDiv.style.color = '#333';
  
  try {
    const now = Date.now();
    let solvedSet = new Set();

    // --- STEP 1: CHECK AND UTILIZE LOCAL SUBMISSION CACHE ---
    let cachedSubmissionData = null;
    const rawCache = localStorage.getItem('cf_submission_history_cache');
    
    if (rawCache) {
      try {
        const parsed = JSON.parse(rawCache);
        // Ensure cache is within expiration period and matches current handles
        const handlesMatch = JSON.stringify(parsed.handles.sort()) === JSON.stringify([...activeHandles].sort());
        if (now - parsed.timestamp < SUBMISSION_CACHE_DURATION && handlesMatch) {
          cachedSubmissionData = new Set(parsed.solvedList);
        }
      } catch (e) {
        localStorage.removeItem('cf_submission_history_cache');
      }
    }

    if (cachedSubmissionData) {
      statusDiv.innerText = "Loaded submission histories from local cache ⚡";
      solvedSet = cachedSubmissionData;
    } else {
      // Fetch fresh submission history from Codeforces API
      for (let i = 0; i < activeHandles.length; i++) {
        statusDiv.innerText = `Fetching submissions [${i + 1}/${activeHandles.length}]: ${activeHandles[i]}`;
        try {
          const res = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(activeHandles[i])}`);
          const data = await res.json();
          if (data.status === 'OK') {
            data.result.forEach(sub => {
              if (sub.verdict === 'OK' && sub.problem) {
                solvedSet.add(sub.problem.contestId + sub.problem.index);
              }
            });
          }
        } catch (e) { 
          console.error(`Failed to fetch submissions for ${activeHandles[i]}:`, e); 
        }
        await delay(REQUEST_DELAY);
      }

      // Store fetched submissions in localStorage
      localStorage.setItem('cf_submission_history_cache', JSON.stringify({
        timestamp: now,
        handles: activeHandles,
        solvedList: Array.from(solvedSet)
      }));
    }

    // --- STEP 2: FETCH PROBLEMS FROM CODEFORCES API ---
    statusDiv.innerText = "Fetching problems from Codeforces...";
    const pRes = await fetch(`https://codeforces.com/api/problemset.problems?includeGym=${includeGym}`);
    const pData = await pRes.json();
    
    let allProblems = [];
    if (pData.status === 'OK') {
      allProblems = pData.result.problems.map(p => ({
        contestId: p.contestId,
        index: p.index,
        name: p.name,
        rating: p.rating, // Undefined for Gym / unrated problems
        tags: p.tags || [],
        // Gym problems don't always have contestId >= 100000; check rating existence or contest structure
        isGym: p.rating === undefined || p.contestId >= 100000,
        url: (p.contestId >= 100000 || p.rating === undefined)
             ? `https://codeforces.com/gym/${p.contestId}/problem/${p.index}`
             : `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
      }));
    }

    // --- STEP 3: FILTER PROBLEMS ---
    statusDiv.innerText = "Filtering problems...";
    const filtered = allProblems.filter(p => {
      const uniqueKey = p.contestId + p.index;
      
      // 1. Exclude solved problems
      if (solvedSet.has(uniqueKey)) return false;
      
      // 2. Rating Boundary Filter
      // FIX: If Gym checkbox is checked and problem is Gym/Unrated, skip rating checks
      if (p.isGym) {
        if (!includeGym) return false; // Exclude Gym if unchecked
      } else {
        // Standard rated problem rating validation
        if (p.rating === undefined || p.rating < minRating || p.rating > maxRating) return false;
      }

      // 3. Tag Filter
      if (selectedTags.size > 0) {
        if (!p.tags || p.tags.length === 0) return false;
        const pTags = p.tags.map(t => t.toLowerCase());
        for (let requiredTag of selectedTags) {
          if (!pTags.includes(requiredTag)) return false;
        }
      }
      return true;
    });

    // Randomize and limit results
    const shuffled = filtered.sort(() => 0.5 - Math.random()).slice(0, count);

    // --- STEP 4: RENDER RESULTS ---
    if (shuffled.length === 0) {
      statusDiv.innerText = "No matching problems found.";
    } else {
      statusDiv.innerText = `Success! Found ${shuffled.length} problem(s).`;
      shuffled.forEach(p => {
        const problemId = `${p.contestId}${p.index}`;
        
        const card = document.createElement('div');
        card.className = 'problem-card';

        const link = document.createElement('a');
        link.href = p.url;
        link.target = '_blank';
        link.className = 'problem-link';
        link.innerText = `[${p.rating ? p.rating : 'Gym'}] ${problemId} - ${p.name}`;

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
    }

  } catch (error) {
    statusDiv.innerText = "Error: " + error.message;
    statusDiv.style.color = '#dc3545';
  } finally {
    findBtn.disabled = false;
  }
});
