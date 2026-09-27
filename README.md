# Internal Medicine 63-Day Clinical Study Planner

A mobile-first Progressive Web App (PWA) that turns the 63-day Internal Medicine study plan into a daily to-do list with study timer, progress tracking, mistakes log, and offline support.

## Features

- **Today view** — auto-opens the correct day based on device date
- **Daily tasks** from the plan (AMBOSS, Questions, Clinical Recall, Mistakes) + custom tasks
- **Study Timer** — Focus / Short Break / Long Break / Free, Pomodoro, timestamp-based (survives refresh & background)
- **Calendar** — all 63 days with status (Completed / In Progress / Missed / Rest)
- **Progress dashboard** — overall progress, study statistics, 7-day chart, session history
- **Mistakes log** — searchable & filterable by system + Quick Review
- **Notes** per day (auto-saved)
- **Streak** based on study days (≥1 task completed)
- **Catch Up** for unfinished previous days
- **Dark / Light mode**
- **Export / Import backup** (JSON)
- **Reset progress** (with confirmation)
- **PWA** — installable, offline-first (service worker + localStorage)

## Tech

- Vanilla HTML / CSS / JavaScript
- `study-plan.json` generated from the official Excel plan
- LocalStorage key: `internalMedicinePlanner_v1`
- No backend, no external dependencies

## Run

Serve the folder over HTTP (required for service worker & fetch):

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open the URL on phone or desktop. Install via browser “Add to Home Screen”.

## Plan

- Starts: **Sunday 27 September 2026**
- 63 days, Fridays are rest days
- Source: `Internal_Medicine_63_Day_Plan_PALDOSE.xlsx` → `study-plan.json`

## Data

All user data (progress, notes, custom tasks, mistakes, timer sessions, settings) lives in LocalStorage. Use **Export My Data** in Settings before clearing browser data.
