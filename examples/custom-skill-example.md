# Example: Custom Brand Voice Skill

This is an example of a custom skill that enforces a specific brand voice for content generation. Adapt it for your own brand, product, or team voice.

## How to create your own

1. Create a directory under `skills/` with your skill name (e.g., `skills/my-brand/`)
2. Add a `SKILL.md` file inside it
3. Run the setup script to install, or manually copy to `~/.claude/skills/`

## Example SKILL.md

```markdown
---
description: "Brand voice and content guidelines for Acme Corp. Use when generating marketing content, social posts, ad copy, blog articles, or customer-facing materials."
---

# Acme Corp Brand Voice

## Core Identity
- **Company:** Acme Corp — widget manufacturer since 1985
- **Tone:** Professional but approachable. Technical credibility without jargon.
- **Audience:** Small business owners, procurement managers

## Voice Guidelines
- Use active voice
- Lead with benefits, not features
- Include specific numbers when possible ("saves 3 hours/week" not "saves time")
- Never use: "synergy", "leverage", "disrupt", "game-changing"

## Content Templates

### Social Post
[Hook — 1 sentence max] + [Value prop] + [CTA]

### Blog Article
- 800-1200 words
- H2 headers every 200-300 words
- Include at least one customer quote or data point
- End with clear next step

## Brand Assets
- Primary color: #2563EB
- Logo usage: always include ™ on first reference
- Tagline: "Built to Last. Priced to Move."
```

## How skills trigger

The `description` field in the frontmatter determines when Claude activates the skill. Include keywords that match user requests — Claude scans descriptions to find relevant skills for each task.
