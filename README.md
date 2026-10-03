# 🎯 Codeforces Problem Picker

> A fast, lightweight web utility for competitive programmers to discover target practice problems for individual or group training sessions without manual checking.

---

## 💡 Use Cases

- **👥 Group Mashups & Duo Practice:** Find problems that *none* of your practice partners or club members have solved yet—no more cross-referencing profiles manually.
- **🎯 Targeted Topic Improvement:** Select specific tags (like `dp`, `graphs`, or `number theory`) to drill down on your weak areas at your current rating level.
- **⚡ Fast Contest Preparation:** Quickly generate a balanced list of fresh, rated problems within an exact difficulty range for a timed practice session.

---

## ✨ Key Features

- **Multi-User Unsolved Filtering:** Upload a list of handles to automatically filter out problems already solved by anyone in your group.
- **Interactive Tag Selection:** Toggle official Codeforces topic tags with a single click—eliminating manual typing or tag name errors.
- **Precise Rating Bounds:** Set strict minimum and maximum difficulty ratings to get problems tailored to your target skill level.
- **Official Problem Guarantee:** Automatically excludes unrated Gym contests so you only get official, rated Codeforces problems.
- **Smart Dual-Layer Caching:** Utilizes `localStorage` for friend submission histories (1 hour) and global problem sets (7 days) to minimize API wait times and load results instantly.
- **Persistent Storage:** Automatically saves your uploaded handle list locally so you don't need to re-upload your file every session.

---

## 📖 How to Use

1. **Upload Handles:** Create a simple `.txt` file containing Codeforces handles (one handle per line) and upload it using the file picker.
2. **Select Tags:** Click on any topic tags you want to practice (e.g., `dp`, `trees`, `greedy`).
3. **Set Rating & Count:** Enter your target `Min Rating`, `Max Rating`, and the number of problems you want.
4. **Find Problems:** Click **Find Problems**. The tool will sync the data and generate direct links to matching unsolved problems.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+)
- **API:** Codeforces REST API
- **Deployment:** Vercel

---

<p align="center">
  Crafted by <a href="https://github.com/thakuremon">Emon Thakur</a>
</p>
