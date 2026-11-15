# Handoff: deploy the `climate-news` function

**For:** Max, since it's your Supabase project
**Time:** about 10 minutes
**Code:** already on `chris` and merged as soon as you pull it. The function is [`supabase/functions/climate-news/index.ts`](supabase/functions/climate-news/index.ts). The site side is `fetchNews()` in `trend-explorer.js`.

## Why

The sidebar's **News** panel shows recent articles about the selected measurement in the selected place, for example "heatwave / temperature" in "Ontario / Canada".

Right now the browser calls GDELT directly. GDELT allows one request every 5 seconds **per IP**, so a room full of judges on the same venue Wi-Fi will hit that limit. During testing it refused every request from Chris's network.

Running it through a Supabase function fixes this:
- The function caches each search for 6 hours.
- It uses **The Guardian Open Platform**, which needs a free key and has a far higher limit, with GDELT as backup.

Until the function is deployed, the site falls back to calling GDELT from the browser. If that fails too, it shows "More on Google News", which always works.

## Steps

1. **Get a free Guardian key.** Go to https://open-platform.theguardian.com/access/ and choose "Register developer key". It's free for non-commercial use. Check the rate limits shown when you sign up; the 6-hour cache keeps usage low.

2. **Store it as a secret.** Never put it in the repo or in `.env.example`.

   ```sh
   supabase secrets set GUARDIAN_API_KEY=your-key-here
   ```

3. **Deploy.** It's the same way as `climate-research-giovanni`. The site sends the anon key as the bearer token, so the default JWT check is fine.

   ```sh
   supabase functions deploy climate-news
   ```

4. **Test it.** Use the anon key from `trend-config.js`:

   ```sh
   curl -s -X POST "https://vbumlhsonrozcrzcuirm.supabase.co/functions/v1/climate-news" \
     -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
     -d '{"topics":["drought","rainfall"],"places":["Kenya"]}'
   ```

   It should return `{"articles":[{"title":…,"url":"https://…","source":"The Guardian","date":"2026-…"}]}`.

5. **Check the site.** Select Southern Ontario and open **News** at the bottom of the sidebar. You should see up to 5 headlines with "The Guardian · date".

## How it behaves

- **Input:** `{ topics: 1–4 terms, places: 1–3 terms }`. Each term may contain only letters, spaces and `.'-`, at most 60 characters. Anything else gets a 400, so nobody can inject query syntax.
- **Order:** it tries The Guardian (articles from the last 2 years, sorted by relevance), then GDELT (last 3 months), and returns up to 5 articles.
- **Errors:** if both fail it returns 502, and the site then tries GDELT from the browser, then shows the Google News link.
- **Caching:** the cache is in memory per function instance, so a cold start clears it. That's fine for a demo.

## Tested locally

I ran the function in Node with a stand-in for Deno:
- Preflight returns 204.
- Bad or missing terms return 400.
- An unreachable source returns a clean 502.

The site rendered a faked function response correctly and dropped an unsafe `javascript:` link. **Live Guardian results are untested**, because the old public `test` key now returns 401, which is why a real key is needed.

## Note for judges

News comes from The Guardian and GDELT. They are **not** challenge data sources: the panel is context only, and every number on the site still comes from NASA Giovanni and KNMI.
