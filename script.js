const REQUEST_DELAY = 300; 
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const FRIENDS_CACHE_DURATION = 60 * 60 * 1000;        
const PROBLEMS_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; 

// The comprehensive array of all official Codeforces problem tags
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

// Populate the visual tag selectors dynamically on startup
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

  // Load handles from localStorage cache if present
  const cachedFriends = localStorage.getItem('cf_saved_friends');
  const fileStatusDiv = document.getElementById('fileStatus');
  if (cachedFriends) {
    loadedFriends = JSON.parse(cachedFriends);
    fileStatusDiv.innerText = `✓ Loaded ${loadedFriends.length} handles from persistent storage.`;
    fileStatusDiv.style.color = '#28a745';
  }
});

// Watch for file upload changes and save values
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
    const now = Date.now();
    
    // --- LAYER 1: FRIEND SUBMISSION CACHE ---
    const cachedFriendsData = localStorage.getItem('cf_submission_history_cache');
    const cachedFriendsTime = localStorage.getItem('cf_submission_history_time');

    if (cachedFriendsData && cachedFriendsTime && (now - parseInt(cachedFriendsTime) < FRIENDS_CACHE_DURATION)) {
      statusDiv.innerText = "Loading cached friend problem histories...";
      solvedSet = new Set(JSON.parse(cachedFriendsData));
    } else {
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
      localStorage.setItem('cf_submission_history_time', now.toString());
    }

    // --- LAYER 2: GLOBAL PROBLEM LIST CACHE ---
    let allProblems = [];
    const cachedProblemsData = localStorage.getItem('cf_global_problems_cache');
    const cachedProblemsTime = localStorage.getItem('cf_global_problems_time');

    if (cachedProblemsData && cachedProblemsTime && (now - parseInt(cachedProblemsTime) < PROBLEMS_CACHE_DURATION)) {
      statusDiv.innerText = "Loading cached Codeforces problem sets...";
      allProblems = JSON.parse(cachedProblemsData);
    } else {
      statusDiv.innerText = "Fetching fresh standard problems from CF...";
      const pRes = await fetch('https://codeforces.com/api/problemset.problems');
      const pData = await pRes.json();
      
      if (pData.status === 'OK') {
        allProblems = pData.result.problems.map(p => ({
          contestId: p.contestId,
          index: p.index,
          name: p.name,
          rating: p.rating,
          tags: p.tags,
          url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`
        }));
      }

      if (allProblems.length > 0) {
        localStorage.setItem('cf_global_problems_cache', JSON.stringify(allProblems));
        localStorage.setItem('cf_global_problems_time', now.toString());
      }
    }

    // --- FILTERING LOGIC ---
    statusDiv.innerText = "Filtering results...";
    const filtered = allProblems.filter(p => {
      const uniqueKey = p.contestId + p.index;
      
      // 1. Skip if solved by any friend
      if (solvedSet.has(uniqueKey)) return false;
      
      // 2. Skip if it doesn't have an official rating or falls out of bounds
      if (p.rating === undefined || p.rating < minRating || p.rating > maxRating) return false;

      // 3. Match against the interactive selected tags set
      if (selectedTags.size > 0) {
        if (!p.tags) return false;
        const pTags = p.tags.map(t => t.toLowerCase());
        
        // Ensure every single selected tag is active on this problem
        for (let requiredTag of selectedTags) {
          if (!pTags.includes(requiredTag)) return false;
        }
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
        a.innerText = `[${p.rating}] ${p.name}`;
        resultsDiv.appendChild(a);
      });
    }

  } catch (error) {
    statusDiv.innerText = "Error: " + error.message;
  } finally {
    findBtn.disabled = false;
  }
});
