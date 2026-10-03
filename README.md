# 🎯 Codeforces Problem Picker

> A fast, lightweight web utility for competitive programmers to discover target practice problems for individual or group training sessions without manual checking.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-000000?style=for-the-badge&logo=vercel)](https://codeforces-problem-picker.vercel.app)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Codeforces API](https://img.shields.io/badge/Codeforces%20API-Integrated-3178C6?style=for-the-badge&logo=codeforces)](https://codeforces.com/apiHelp)

---

## 💡 Use Cases

- **👥 Group Mashups & Duo Practice:** Find problems that *none* of your practice partners or club members have solved yet—no more cross-referencing profiles manually.
- **🎯 Targeted Topic Improvement:** Select specific tags (like `dp`, `graphs`, or `number theory`) to drill down on your weak areas at your current rating level.
- **🏋️ Gym & Contest Training:** Toggle Gym problems to train on contest archives and community sets alongside standard rated problems.
- **📋 Rapid ID Export:** Instantly copy problem codes (e.g., `2060B`) to share directly in Discord, group chats, or custom contest mashups.

---

## ✨ Key Features

- **Flexible Handle Input:** Enter a single handle directly or upload a `.txt` file with your friends' handles to filter out problems solved by anyone in your group.
- **Optional Gym Problem Support:** Includes a dedicated toggle to pull Gym/archive contests, bypassing rating bounds for full problem set coverage.
- **One-Click Copy Problem ID:** Integrated `Copy ID` button on every generated problem card for instant pasting into mashup creators or messaging apps.
- **Interactive Tag Selection:** Toggle official Codeforces topic tags with a single click—eliminating manual typing or tag name errors.
- **Precise Rating Bounds:** Set strict minimum and maximum difficulty ratings for standard rated problems.
- **Smart Dual-Layer Caching:** Utilizes `localStorage` for friend submission histories (1 hour) and global problem sets (7 days) to minimize API wait times and load results instantly.
- **Persistent Storage:** Automatically saves your uploaded handle list locally so you don't need to re-upload your file every session.

---

## 📖 How to Use

1. **Enter Handles:** Enter a single Codeforces handle in the text field OR upload a `.txt` file containing multiple handles (one handle per line).
2. **Configure Options:** Toggle **Include Gym Problems** if you want to include unrated or gym archive problems.
3. **Select Tags:** Click on any topic tags you want to practice (e.g., `dp`, `trees`, `greedy`).
4. **Set Rating & Count:** Enter your target `Min Rating`, `Max Rating`, and the number of problems you want.
5. **Find & Copy:** Click **Find Problems**. Click **Copy ID** on any result card to copy its ID directly to your clipboard.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3 (Flexbox), Vanilla JavaScript (ES6+)
- **API:** Codeforces REST API
- **Analytics:** Vercel Web Analytics & Speed Insights
- **Hosting:** Vercel

---

<p align="center">
  Crafted by <a href="https://github.com/thakuremon">Emon Thakur</a>
</p>
