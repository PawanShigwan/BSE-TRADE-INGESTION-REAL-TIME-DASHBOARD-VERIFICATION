
# Architecture — BSE Trade Ingestion System

## 1. Architecture Diagram
<img width="1536" height="1024" alt="Architecture Diagram" src="https://github.com/user-attachments/assets/3b8576b2-d4eb-4aaf-8105-44847131bff1" />

## 2. Architecture Overview

The system is divided into four main responsibilities:

1. **Mock BSE API** — simulates the BSE `GET /getTrades` endpoint with seeded trade data, cursor-based pagination, and configurable delays.
2. **Ingestion Worker** — pulls the complete dataset in small cursor-based chunks instead of keeping one HTTP connection open for the entire operation.
3. **MongoDB Atlas** — persistently stores ingested trades and ingestion job state, including the current cursor and pull status.
4. **Backend + Dashboard** — the backend exposes REST APIs for initial data loading and provides a WebSocket channel for real-time updates to the dashboard.

The browser communicates only with the backend. It does not connect directly to MongoDB.

## 3. Why This Design?

### Solving the 30-Second HTTP Constraint

A complete BSE pull can take up to 15 minutes, while the corporate network terminates HTTP connections after 30 seconds.

A single request such as:

```text
Dashboard → GET /getTrades → 15 minutes → Response
```

would therefore fail.

Instead, the ingestion worker uses cursor pagination:

```text
GET /getTrades?cursor=0&limit=500
        ↓
      200 OK
        ↓
GET /getTrades?cursor=500&limit=500
        ↓
      200 OK
        ↓
GET /getTrades?cursor=1000&limit=500
        ↓
       ...
```

Each HTTP request is independently completed well before the 30-second limit, while the overall ingestion process can continue for much longer.

### Background Ingestion

Starting a pull does not keep the user's HTTP request open.

```text
POST /api/pull/start
        ↓
   Job created
        ↓
Immediate response
        ↓
Background worker continues pulling
```

This allows the dashboard and backend to remain responsive while ingestion is running.

### MongoDB Persistence

MongoDB Atlas is used to persist:

- Trade records
- Pull job status
- Current/next cursor
- Number of records processed
- Error and completion information

This means the dashboard can immediately display trades that were previously ingested, even when a new BSE pull is currently running.

MongoDB also allows the ingestion process to resume from its saved cursor after an interruption.

### Real-Time Updates Without Polling

The dashboard must update automatically without page refreshes, polling loops, or cron jobs.

Therefore, the backend uses WebSockets to push ingestion events:

```text
Ingestion Worker
      ↓
Backend WebSocket
      ↓
Dashboard
```

Events include:

```text
PULL_STARTED
CHUNK_INGESTED
PULL_COMPLETED
```

When the dashboard receives an event, it updates its state and UI immediately.

There is no:

```javascript
setInterval(() => fetch(...))
```

or other continuous polling mechanism.

## 4. Data Flow

The complete flow is:

```text
1. User starts a pull
        ↓
2. Backend creates a pull job
        ↓
3. Backend immediately responds with jobId
        ↓
4. Ingestion worker starts in the background
        ↓
5. Worker requests BSE data using cursor pagination
        ↓
6. Each chunk is stored in MongoDB
        ↓
7. Worker sends ingestion events through WebSocket
        ↓
8. Dashboard receives the events
        ↓
9. Dashboard updates without page refresh
        ↓
10. Pull completes and job state is marked COMPLETED
```

## 5. Key Design Principles

| Requirement | Design Decision |
|---|---|
| BSE operation can take up to 15 minutes | Background ingestion worker |
| HTTP connection limited to 30 seconds | Cursor-based chunked requests |
| Dashboard must load existing trades immediately | MongoDB persistent storage |
| No page refresh | Reactive WebSocket updates |
| No polling | Server-pushed WebSocket events |
| Pull must survive interruption | Persisted cursor/job state |
| Duplicate trades must be prevented | Unique `tradeId` + upsert |
| Browser must not access database directly | Backend API acts as the data-access layer |

## 6. Design Summary

The architecture separates **data acquisition, persistence, and presentation**.

The Mock BSE API represents the slow external system. The ingestion worker handles the long-running operation using short, independently completed HTTP requests. MongoDB provides persistent trade and job state, while the backend exposes the stored data to the dashboard. WebSockets provide event-driven real-time updates without requiring browser polling or page refreshes.

This design directly addresses the assessment's two primary constraints: **avoiding HTTP connections longer than 30 seconds and updating the dashboard automatically when new trades become available.**
