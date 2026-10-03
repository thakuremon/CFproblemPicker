const REQUEST_DELAY = 300; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

// Startup initialization
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

// Save uploaded handle list permanently
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
      fileStatusDiv.innerText = `✓ Saved ${loadedFriends.length} handle(s) locally.`;
      fileStatusDiv.style.color = '#28a745';
    } else {
      fileStatusDiv.innerText = "Error: Uploaded file is empty.";
      fileStatusDiv.style.color = '#dc3545';
    }
  };
  reader.readAsText(file);
});

// Helper function: Fetch or read user submission history from localStorage
async function getSolvedProblemsForHandle(handle, statusDiv) {
  const cacheKey = `cf_user_solved_${handle.toLowerCase()}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return new Set(parsed);
    } catch (e) {
      localStorage.removeItem(cacheKey);
    }
  }

  // Fetch from Codeforces API if not cached
  statusDiv.innerText = `Fetching submissions from API: ${handle}...`;
  const solved = new Set();
  try {
    const res = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}`);
    const data = await res.json();
    if (data.status === 'OK') {
      data.result.forEach(sub => {
        if (sub.verdict === 'OK' && sub.problem && sub.problem.contestId) {
          solved.add(sub.problem.contestId + sub.problem.index);
        }
      });
      // Store in localStorage permanently
      localStorage.setItem(cacheKey, JSON.stringify(Array.from(solved)));
    }
  } catch (e) {
    console.error(`Error fetching data for ${handle}:`, e);
  }
  
  await delay(REQUEST_DELAY);
  return solved;
}

// Main Button Action
document.getElementById('findBtn').addEventListener('click', async () => {
  const findBtn = document.getElementById('findBtn');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  
  const singleHandle = document.getElementById('singleHandleInput').value.trim();
  const includeGym = document.getElementById('includeGymCheckbox').checked;
  const minRating = parseInt(document.getElementById('minRating').value) || 0;
  const maxRating = parseInt(document.getElementById('maxRating').value) || 5000;
  const count = parseInt(document.getElementById('count').value) || 5;

  let activeHandles = [...loadedFriends];
  if (singleHandle) {
    activeHandles.push(singleHandle);
  }
  activeHandles = [...new Set(activeHandles)];

  if (activeHandles.length === 0) {
    statusDiv.innerText = "Error: Please enter a handle or upload a handles file.";
    statusDiv.style.color = '#dc3545';
    return;
  }

  findBtn.disabled = true;
  resultsDiv.innerHTML = '';
  statusDiv.style.color = '#333';
  
  try {
    // --- STEP 1: CONSOLIDATE SOLVED PROBLEMS ACROSS ALL HANDLES ---
    let combinedSolvedSet = new Set();
    for (let i = 0; i < activeHandles.length; i++) {
      const handle = activeHandles[i];
      const handleSolved = await getSolvedProblemsForHandle(handle, statusDiv);
      handleSolved.forEach(id => combinedSolvedSet.add(id));
    }

    statusDiv.innerText = "Loading problem set from Codeforces...";

    // --- STEP 2: FETCH GLOBAL PROBLEMS ---
    const pRes = await fetch(`https://codeforces.com/api/problemset.problems?includeGym=true`);
    const pData = await pRes.json();
    
    if (pData.status !== 'OK') {
      throw new Error("Failed to load problem set from Codeforces API.");
    }

    const allProblems = pData.result.problems.map(p => {
      const isGym = p.contestId >= 100000 || p.rating === undefined;
      return {
        contestId: p.contestId,
        index: p.index,
        name: p.name,
        rating: p.rating,
        tags: p.tags || [],
        isGym: isGym,
        url: isGym 
             ? `https://codeforces.com/gym/${p.contestId}/problem/${p.index}`
             : `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
      };
    });

    // --- STEP 3: FILTER AND SEPARATE INTO GYM AND STANDARD POOLS ---
    const gymPool = [];
    const standardPool = [];

    allProblems.forEach(p => {
      const uniqueKey = p.contestId + p.index;

      // 1. Skip solved problems
      if (combinedSolvedSet.has(uniqueKey)) return;

      // 2. Filter by Tags
      if (selectedTags.size > 0) {
        if (!p.tags || p.tags.length === 0) return;
        const pTags = p.tags.map(t => t.toLowerCase());
        for (let requiredTag of selectedTags) {
          if (!pTags.includes(requiredTag)) return;
        }
      }

      // 3. Separate into Pools & Apply Rating Bounds to Standard Problems
      if (p.isGym) {
        gymPool.push(p);
      } else {
        if (p.rating !== undefined && p.rating >= minRating && p.rating <= maxRating) {
          standardPool.push(p);
        }
      }
    });

    // Randomize Pools
    gymPool.sort(() => 0.5 - Math.random());
    standardPool.sort(() => 0.5 - Math.random());

    // --- STEP 4: SELECT 50% GYM & 50% STANDARD IF CHECKED ---
    let selectedProblems = [];

    if (includeGym) {
      const gymTarget = Math.ceil(count / 2);
      const standardTarget = count - gymTarget;

      const pickedGym = gymPool.slice(0, gymTarget);
      const pickedStandard = standardPool.slice(0, standardTarget);

      selectedProblems = [...pickedGym, ...pickedStandard];

      // Fill remaining slots if one pool ran out of problems
      if (selectedProblems.length < count) {
        const remainingNeeded = count - selectedProblems.length;
        const remainingGym = gymPool.slice(gymTarget);
        const remainingStandard = standardPool.slice(standardTarget);
        selectedProblems.push(...remainingGym.concat(remainingStandard).slice(0, remainingNeeded));
      }
    } else {
      selectedProblems = standardPool.slice(0, count);
    }

    // Final Shuffle so Gym and Standard problems are mixed
    selectedProblems.sort(() => 0.5 - Math.random());

    // --- STEP 5: RENDER RESULTS ---
    if (selectedProblems.length === 0) {
      statusDiv.innerText = "No matching problems found.";
    } else {
      statusDiv.innerText = `Success! Selected ${selectedProblems.length} problem(s).`;
      
      selectedProblems.forEach(p => {
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
