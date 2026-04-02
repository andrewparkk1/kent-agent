# AgentCash — Web Search, Scraping & 300+ APIs

Use `run_command` to execute these. Requires `npx agentcash onboard` (already done).

AgentCash gives you pay-per-call access to web search, web scraping, people/company research, social media data, image generation, email sending, and more. Use it whenever you need information from the internet.

## Web Search (via Exa on StableEnrich)

```bash
# Search the web
npx agentcash fetch "https://stableenrich.dev/api/exa/search" \
  -m POST \
  -b '{"query": "latest news about AI agents", "numResults": 5}'

# Get page contents from a search
npx agentcash fetch "https://stableenrich.dev/api/exa/search" \
  -m POST \
  -b '{"query": "React server components tutorial", "numResults": 3, "contents": true}'
```

## Web Search (via Serper/Google on StableEnrich)

```bash
# Google search results
npx agentcash fetch "https://stableenrich.dev/api/serper/search" \
  -m POST \
  -b '{"q": "site:github.com bun sqlite orm"}'
```

## Web Scraping (via Firecrawl on StableEnrich)

```bash
# Scrape a webpage and get clean markdown
npx agentcash fetch "https://stableenrich.dev/api/firecrawl/scrape" \
  -m POST \
  -b '{"url": "https://example.com/article"}'
```

## People & Company Research

```bash
# Enrich a person by email
npx agentcash fetch "https://stableenrich.dev/api/apollo/people-enrich" \
  -m POST \
  -b '{"email": "user@example.com"}'

# Enrich a company by domain
npx agentcash fetch "https://stableenrich.dev/api/apollo/company-enrich" \
  -m POST \
  -b '{"domain": "example.com"}'
```

## Social Media Data

```bash
# Get Instagram profile
npx agentcash fetch "https://stablesocial.dev/api/instagram/profile" \
  -m POST \
  -b '{"username": "example"}'

# Get YouTube video info
npx agentcash fetch "https://stablesocial.dev/api/youtube/video" \
  -m POST \
  -b '{"url": "https://youtube.com/watch?v=..."}'

# Get Reddit post/comments
npx agentcash fetch "https://stablesocial.dev/api/reddit/post" \
  -m POST \
  -b '{"url": "https://reddit.com/r/..."}'
```

## Image Generation

```bash
# Generate an image
npx agentcash fetch "https://stablestudio.dev/api/generate" \
  -m POST \
  -b '{"prompt": "a capybara wearing sunglasses", "width": 1024, "height": 1024}'
```

## File Upload

```bash
# Upload a file and get a permanent URL
npx agentcash fetch "https://stableupload.dev/api/upload" \
  -m POST \
  -b '{"url": "https://example.com/image.png"}'
```

## Email

```bash
# Send an email
npx agentcash fetch "https://stableemail.dev/api/send" \
  -m POST \
  -b '{"to": "user@example.com", "subject": "Hello", "body": "..."}'
```

## Utility Commands

```bash
# Check your balance
npx agentcash balance

# Discover all endpoints on any origin
npx agentcash discover https://stableenrich.dev

# Check pricing/schema for an endpoint (no charge)
npx agentcash check https://stableenrich.dev/api/exa/search

# Discover endpoints on any origin
npx agentcash discover https://stablesocial.dev
```

## Available Origins

| Origin | What it has |
|--------|-------------|
| `stableenrich.dev` | Exa search, Serper/Google, Firecrawl scraping, Apollo people/company enrichment |
| `stablesocial.dev` | Instagram, TikTok, YouTube, Reddit, Facebook data |
| `stablestudio.dev` | AI image/video generation |
| `stableupload.dev` | File hosting with permanent URLs |
| `stableemail.dev` | Transactional and outreach email |

## Tips

- Use `npx agentcash check <url>` to see exact pricing and input schema before calling an endpoint
- Use `npx agentcash discover <origin>` to find all available endpoints — there are 300+ total
- Add `--max-amount 0.10` to any fetch to cap spend per request
- The exact endpoint paths and parameters may change — always `check` or `discover` first if unsure
