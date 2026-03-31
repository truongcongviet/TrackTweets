# TrackTweet

Next.js dashboard to track hourly tweet/post activity for `@elonmusk` using Polymarket's XTracker API and render a heatmap similar to the reference screenshot.

## Run

```bash
yarn install --registry https://registry.npmjs.org
yarn dev
```

Open `http://localhost:3000`.

## Features

- API route: `GET /api/xtracker/[handle]/hourly`
- Groups posts by `date x hour`
- Supports custom `start`, `end`, and `timezone`
- Heatmap UI with daily totals and intensity scale

## Notes

- The app fetches raw posts from XTracker, then groups them locally.
- If you need long-term history or deleted-post capture, add a polling worker and persist post IDs to a database.
