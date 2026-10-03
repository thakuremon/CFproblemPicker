const REQUEST_DELAY = 300; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const FRIENDS_CACHE_DURATION = 60 * 60 * 1000;        
const PROBLEMS_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; 

// Comprehensive array of official Codeforces problem tags
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

  // Check localStorage for previously saved friends file handles
  const cachedFriends = localStorage.getItem('cf_saved_friends');
  const fileStatusDiv = document.getElementById('fileStatus');
  if (cachedFriends) {
    loadedFriends = JSON.parse(cachedFriends);
    fileStatusDiv.innerText = `✓ Loaded ${loadedFriends.length} handle(s) from local cache.`;
    fileStatusDiv.style.color = '#28a745';
  }
});

// Watch for file upload changes and update local storage
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
      localStorage.removeItem('cf_submission_history_cache');
      fileStatusDiv.innerText = `✓ Successfully saved ${loadedFriends.length} handle(s).`;
      fileStatusDiv.style.color = '#28a745';
    } else {
      fileStatusDiv.innerText = "Error: Uploaded file is empty.";
      fileStatusDiv.style.color = '#dc3545';
    }
  };
  reader.readAsText(file);
});

// Main button execution handler
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
    let solvedSet = new Set();
    const now = Date.now();
    
    // --- STEP 1: FETCH SUBMISSION HISTORY FOR ALL HANDLES ---
    for (let i = 0; i < activeHandles.length; i++) {
      statusDiv.innerText = `Syncing data [${i + 1}/${activeHandles.length}]: ${activeHandles[i]}`;
      try {
        const res = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(activeHandles[i])}`);
        const data = await res.json();
        if (data.status === 'OK') {
          data.result.forEach(sub => {
            if (sub.verdict === 'OK') {
              solvedSet.add(sub.problem.contestId + sub.problem.index);
            }
          });
        }
      } catch (e) { 
        console.error(`Failed to fetch submissions for ${activeHandles[i]}:`, e); 
      }
      await delay(REQUEST_DELAY);
    }

    // --- STEP 2: FETCH GLOBAL PROBLEM SET (GENERAL + GYM IF CHECKED) ---
    statusDiv.innerText = "Fetching problems from Codeforces...";
    const pRes = await fetch(`https://codeforces.com/api/problemset.problems?includeGym=${includeGym}`);
    const pData = await pRes.json();
    
    let allProblems = [];
    if (pData.status === 'OK') {
      allProblems = pData.result.problems.map(p => ({
        contestId: p.contestId,
        index: p.index,
        name: p.name,
        rating: p.rating,
        tags: p.tags,
        url: p.contestId < 100000 
             ? `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
             : `https://codeforces.com/gym/${p.contestId}/problem/${p.index}`
      }));
    }

    // --- STEP 3: APPLY FILTERS ---
    statusDiv.innerText = "Filtering problems...";
    const filtered = allProblems.filter(p => {
      const uniqueKey = p.contestId + p.index;
      
      // 1. Filter out problems already solved by any specified user
      if (solvedSet.has(uniqueKey)) return false;
      
      // 2. Rating Boundary Filter (Skip rating boundaries for Gym problems)
      const isGym = p.contestId >= 100000;
      if (!isGym) {
        if (p.rating === undefined || p.rating < minRating || p.rating > maxRating) return false;
      }

      // 3. Selected Tags Filter
      if (selectedTags.size > 0) {
        if (!p.tags) return false;
        const pTags = p.tags.map(t => t.toLowerCase());
        for (let requiredTag of selectedTags) {
          if (!pTags.includes(requiredTag)) return false;
        }
      }
      return true;
    });

    // Randomize and limit results
    const shuffled = filtered.sort(() => 0.5 - Math.random()).slice(0, count);

    // --- STEP 4: RENDER RESULTS WITH COPY BUTTON ---
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
        link.innerText = `[${p.rating || 'Gym'}] ${problemId} - ${p.name}`;

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
