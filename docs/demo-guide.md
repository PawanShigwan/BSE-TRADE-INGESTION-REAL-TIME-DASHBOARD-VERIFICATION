# Project Demo & Evaluation Guide

**Candidate**: Pawan Shigwan  
**Company**: ARHAM Fintech  

---

## 🚀 Quick Execution Guide

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Start services (Mock BSE API + Ingestion Engine & Dashboard)
npm start

# 4. Access Live Trades Dashboard
# http://localhost:4000
```

---

## 🧪 Automated Verification Script

To execute the complete 15-point assessment verification test suite:

```bash
node tests/verify-all.js
```

Or run individual unit tests:

```bash
npm test
```

---

## 🎥 Walkthrough Video

A video demonstrating the 30-second connection timeout solution, live WebSocket push, MongoDB Atlas persistence, and resilient cursor resumption is recorded and available.
