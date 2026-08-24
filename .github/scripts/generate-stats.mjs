import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const username = process.env.GITHUB_USERNAME || "aayushg2006";
const apiBase = "https://api.github.com";
const outputDirectory = path.resolve("profile");
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${username}-profile-stats`,
  "X-GitHub-Api-Version": "2022-11-28",
};

if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const formatNumber = (value) => new Intl.NumberFormat("en-US").format(value);

const getJson = async (url) => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${detail}`);
  }
  return response.json();
};

const getContributions = async () => {
  if (!process.env.GITHUB_TOKEN) {
    const fallback = await getJson(
      `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=last`,
    );
    return {
      totalContributions: fallback.total.lastYear,
      weeks: [
        {
          contributionDays: fallback.contributions.map(({ date, count }) => ({
            date,
            contributionCount: count,
          })),
        },
      ],
    };
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 365);

  const response = await fetch(`${apiBase}/graphql`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `
        query($login: String!, $from: DateTime!, $to: DateTime!) {
          user(login: $login) {
            contributionsCollection(from: $from, to: $to) {
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    date
                    contributionCount
                  }
                }
              }
            }
          }
        }
      `,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length || !payload.data?.user) {
    throw new Error(
      `GitHub GraphQL contribution query failed: ${JSON.stringify(payload.errors || payload)}`,
    );
  }

  return payload.data.user.contributionsCollection.contributionCalendar;
};

const getRepositories = async () => {
  const repositories = [];

  for (let page = 1; ; page += 1) {
    const pageItems = await getJson(
      `${apiBase}/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100&page=${page}`,
    );
    repositories.push(...pageItems);
    if (pageItems.length < 100) return repositories;
  }
};

const collectLanguageTotals = async (repositories) => {
  const totals = new Map();

  for (const repository of repositories) {
    try {
      const languages = await getJson(repository.languages_url);
      for (const [language, bytes] of Object.entries(languages)) {
        totals.set(language, (totals.get(language) || 0) + bytes);
      }
    } catch {
      // Keep the card useful if an individual repository is unavailable.
      if (repository.language) {
        totals.set(
          repository.language,
          (totals.get(repository.language) || 0) + Math.max(repository.size, 1),
        );
      }
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
};

const cardFrame = (width, height, title, titleId) => `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${titleId}">
    <title id="${titleId}">${escapeXml(title)}</title>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4.5" fill="#0D1117" stroke="#30363D"/>
`;

const makeStatsCard = (profile, repositories) => {
  const totalStars = repositories.reduce(
    (total, repository) => total + repository.stargazers_count,
    0,
  );
  const metrics = [
    ["Public Repositories", profile.public_repos],
    ["Total Stars", totalStars],
    ["Followers", profile.followers],
    ["Following", profile.following],
  ];
  const title = `${profile.name || profile.login}'s GitHub Stats`;
  const positions = [
    [25, 74],
    [300, 74],
    [25, 124],
    [300, 124],
  ];

  let svg = cardFrame(576, 165, title, "stats-title");
  svg += `
    <text x="25" y="35" fill="#58A6FF" font-family="Segoe UI, Ubuntu, Sans-Serif" font-size="18" font-weight="600">${escapeXml(title)}</text>
  `;
  for (let index = 0; index < metrics.length; index += 1) {
    const [label, value] = metrics[index];
    const [x, y] = positions[index];
    svg += `
      <text x="${x}" y="${y}" fill="#C9D1D9" font-family="Segoe UI, Ubuntu, Sans-Serif" font-size="14" font-weight="600">${escapeXml(label)}</text>
      <text x="${x}" y="${y + 24}" fill="#F0F6FC" font-family="Segoe UI, Ubuntu, Sans-Serif" font-size="20" font-weight="700">${formatNumber(value)}</text>
    `;
  }
  return `${svg.replace(/^[ \t]+$/gm, "")}\n  </svg>\n`;
};

const makeLanguagesCard = (languages) => {
  const colors = ["#3178C6", "#F1E05A", "#3572A5", "#B07219", "#E34C26", "#663399"];
  const total = languages.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
  const barWidth = 250;
  const barHeight = 8;
  let svg = cardFrame(300, 165, "Most Used Languages", "languages-title");
  svg += `
    <text x="25" y="35" fill="#58A6FF" font-family="Segoe UI, Ubuntu, Sans-Serif" font-size="18" font-weight="600">Most Used Languages</text>
    <rect x="25" y="53" width="${barWidth}" height="${barHeight}" rx="4" fill="#21262D"/>
  `;

  let offset = 25;
  languages.forEach(([language, bytes], index) => {
    const width = (bytes / total) * barWidth;
    svg += `<rect x="${offset}" y="53" width="${width}" height="${barHeight}" fill="${colors[index]}"/>`;
    offset += width;
  });

  if (languages.length === 0) {
    svg += `<text x="25" y="92" fill="#8B949E" font-family="Segoe UI, Ubuntu, Sans-Serif" font-size="13">No language data available</text>`;
  } else {
    languages.forEach(([language, bytes], index) => {
      const percentage = ((bytes / total) * 100).toFixed(1);
      const column = index < 3 ? 25 : 165;
      const row = 85 + (index % 3) * 25;
      svg += `
        <circle cx="${column + 5}" cy="${row - 4}" r="5" fill="${colors[index]}"/>
        <text x="${column + 15}" y="${row}" fill="#C9D1D9" font-family="Segoe UI, Ubuntu, Sans-Serif" font-size="11">${escapeXml(language)} ${percentage}%</text>
      `;
    });
  }

  return `${svg.replace(/^[ \t]+$/gm, "")}\n  </svg>\n`;
};

const formatDate = (date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

const formatDateRange = (start, end) =>
  start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;

const getStreaks = (days) => {
  let longest = { count: 0, start: days[0]?.date, end: days[0]?.date };
  let runStart = null;
  let runCount = 0;

  for (const day of days) {
    if (day.contributionCount > 0) {
      if (!runStart) runStart = day.date;
      runCount += 1;
      if (runCount > longest.count) {
        longest = { count: runCount, start: runStart, end: day.date };
      }
    } else {
      runStart = null;
      runCount = 0;
    }
  }

  const latestContributionIndex = days.findLastIndex(
    (day) => day.contributionCount > 0,
  );
  let current = {
    count: 0,
    start: days[latestContributionIndex]?.date,
    end: days[latestContributionIndex]?.date,
  };
  for (let index = latestContributionIndex; index >= 0; index -= 1) {
    if (days[index].contributionCount === 0) break;
    current.count += 1;
    current.start = days[index].date;
  }

  return { longest, current };
};

const makeContributionCard = (calendar) => {
  const days = calendar.weeks.flatMap((week) => week.contributionDays);
  const chartDays = days.slice(-31);
  const { current, longest } = getStreaks(days);
  const width = 900;
  const height = 760;
  const chart = { left: 70, right: 860, top: 450, bottom: 695 };
  const chartWidth = chart.right - chart.left;
  const chartHeight = chart.bottom - chart.top;
  const maximum = Math.max(...chartDays.map((day) => day.contributionCount), 1);
  const yStep = maximum <= 4 ? 1 : 2;
  const yMax = Math.max(yStep * Math.ceil(maximum / yStep), yStep);
  const xStep = chartWidth / Math.max(chartDays.length - 1, 1);
  const y = (count) => chart.bottom - (count / yMax) * chartHeight;
  const points = chartDays
    .map((day, index) => `${chart.left + index * xStep},${y(day.contributionCount)}`)
    .join(" ");
  const grid = [];
  for (let count = 0; count <= yMax; count += yStep) {
    const lineY = y(count);
    grid.push(`
      <line x1="${chart.left}" y1="${lineY}" x2="${chart.right}" y2="${lineY}" stroke="#123B45" stroke-dasharray="2 5" />
      <text x="${chart.left - 12}" y="${lineY + 4}" text-anchor="end" fill="#00E5F0" font-size="11">${count}</text>
    `);
  }
  chartDays.forEach((day, index) => {
    const x = chart.left + index * xStep;
    grid.push(`
      <line x1="${x}" y1="${chart.top}" x2="${x}" y2="${chart.bottom}" stroke="#123B45" stroke-dasharray="2 5" />
      <text x="${x}" y="${chart.bottom + 19}" text-anchor="middle" fill="#00E5F0" font-size="10">${new Date(`${day.date}T00:00:00Z`).getUTCDate()}</text>
    `);
  });

  const skills = [
    ["TS", "TypeScript", "Expert"],
    ["◉", "Node.js", "Expert"],
    ["⚛", "React", "Advanced"],
    ["◆", "Docker", "Advanced"],
    ["♜", "PostgreSQL", "Advanced"],
    ["↯", "Redis", "Advanced"],
  ];
  let skillX = 42;
  const skillMarkup = skills
    .map(([icon, name, level]) => {
      const nameWidth = name.length * 6.2 + 12;
      const levelWidth = level.length * 6.3 + 12;
      const item = `
        <text x="${skillX}" y="286" fill="#D8DEE9" font-size="11" font-weight="600">${escapeXml(icon)} ${escapeXml(name)}</text>
        <rect x="${skillX + nameWidth}" y="273" width="${levelWidth}" height="18" fill="#00E5F0" />
        <text x="${skillX + nameWidth + levelWidth / 2}" y="286" text-anchor="middle" fill="#061116" font-size="11" font-weight="700">${level}</text>
      `;
      skillX += nameWidth + levelWidth + 18;
      return item;
    })
    .join("");

  const currentRange = current.count
    ? formatDateRange(current.start, current.end)
    : "Start contributing to begin";
  const longestRange = longest.count
    ? formatDateRange(longest.start, longest.end)
    : "No contributions yet";
  const period = `${formatDate(days[0].date)} – Present`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="contributions-title">
  <title id="contributions-title">${escapeXml(username)} GitHub contribution stats and activity graph</title>
  <rect width="${width}" height="${height}" fill="#0D1117" />
  <g font-family="Segoe UI, Ubuntu, Sans-Serif">
    <text x="${width / 2}" y="40" text-anchor="middle" fill="#D8DEE9" font-size="18" font-weight="700">▥ STATS &amp; STREAKS</text>

    <line x1="300" y1="82" x2="300" y2="240" stroke="#00E5F0" />
    <line x1="600" y1="82" x2="600" y2="240" stroke="#00E5F0" />
    <text x="150" y="145" text-anchor="middle" fill="#72A7FF" font-size="34" font-weight="700">${formatNumber(calendar.totalContributions)}</text>
    <text x="150" y="187" text-anchor="middle" fill="#D8DEE9" font-size="16">Total Contributions</text>
    <text x="150" y="217" text-anchor="middle" fill="#D8DEE9" font-size="13">${escapeXml(period)}</text>

    <circle cx="450" cy="130" r="43" stroke="#00E5F0" stroke-width="7" />
    <text x="450" y="141" text-anchor="middle" fill="#B47CFF" font-size="29" font-weight="700">${current.count}</text>
    <text x="450" y="193" text-anchor="middle" fill="#00E5F0" font-size="16" font-weight="700">Current Streak</text>
    <text x="450" y="219" text-anchor="middle" fill="#D8DEE9" font-size="13">${escapeXml(currentRange)}</text>

    <text x="750" y="145" text-anchor="middle" fill="#72A7FF" font-size="34" font-weight="700">${longest.count}</text>
    <text x="750" y="187" text-anchor="middle" fill="#D8DEE9" font-size="16">Longest Streak</text>
    <text x="750" y="217" text-anchor="middle" fill="#D8DEE9" font-size="13">${escapeXml(longestRange)}</text>

    ${skillMarkup}
    <line x1="42" y1="322" x2="858" y2="322" stroke="#123B45" />
    <text x="${width / 2}" y="372" text-anchor="middle" fill="#D8DEE9" font-size="18" font-weight="700">▱ ACTIVITY GRAPH</text>
    <text x="${width / 2}" y="414" text-anchor="middle" fill="#00E5F0" font-size="14" font-weight="700">${escapeXml(username)}&apos;s Contribution Graph</text>

    <g>${grid.join("")}</g>
    <polyline points="${points}" stroke="#00E5F0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ${chartDays
      .map((day, index) => `<circle cx="${chart.left + index * xStep}" cy="${y(day.contributionCount)}" r="4" fill="#F0F6FC" />`)
      .join("")}
    <text x="18" y="${(chart.top + chart.bottom) / 2}" transform="rotate(-90 18 ${(chart.top + chart.bottom) / 2})" text-anchor="middle" fill="#00E5F0" font-size="11" font-weight="600">Contributions</text>
    <text x="${width / 2}" y="${chart.bottom + 45}" text-anchor="middle" fill="#00E5F0" font-size="11" font-weight="600">Days</text>
  </g>
</svg>
`;
};

await mkdir(outputDirectory, { recursive: true });
const profile = await getJson(`${apiBase}/users/${encodeURIComponent(username)}`);
const repositories = await getRepositories();
const languages = await collectLanguageTotals(repositories);
const contributions = await getContributions();

await writeFile(
  path.join(outputDirectory, "stats.svg"),
  makeStatsCard(profile, repositories),
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "top-langs.svg"),
  makeLanguagesCard(languages),
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "contributions.svg"),
  makeContributionCard(contributions),
  "utf8",
);

console.log(
  `Generated stats cards for ${username}: ${repositories.length} repositories, ${languages.length} languages`,
);
