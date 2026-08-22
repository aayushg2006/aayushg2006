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

await mkdir(outputDirectory, { recursive: true });
const profile = await getJson(`${apiBase}/users/${encodeURIComponent(username)}`);
const repositories = await getRepositories();
const languages = await collectLanguageTotals(repositories);

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

console.log(
  `Generated stats cards for ${username}: ${repositories.length} repositories, ${languages.length} languages`,
);
